"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  ClipboardList,
  Clock3,
  Crown,
  PackageCheck,
  Plus,
  ShoppingBag,
  ShoppingCart,
  Target,
} from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { analyticsApi } from "@/services/analytics";
import {
  HeroChip,
  HeroStat,
  HeroStats,
  PageHero,
  Panel,
  PanelEmpty,
  RankedBars,
  Segmented,
  StatCard,
  StatGrid,
  heroButtonClass,
  vizColor,
} from "@/components/premium";
import { Bars, Donut, TrendArea } from "@/components/premium/charts";
import { Pill } from "@/components/logistics/yard-ui";
import { count, inrCompact, kgCompact, pct, relativeTime, sentence } from "@/components/premium/format";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const metricOf = (metrics: any[], label: string) => metrics.find((m) => m?.label === label);

const statusTone = (status: string) => {
  const s = status.toUpperCase().replace(/\s+/g, "_");
  if (["COMPLETED", "DELIVERED", "DISPATCH_READY"].includes(s)) return "good" as const;
  if (["DRAFT", "PLANNING_REQUIRED"].includes(s)) return "warn" as const;
  if (s === "CANCELLED") return "bad" as const;
  return "info" as const;
};

export default function SalesDashboard() {
  const [trendMode, setTrendMode] = useState<"weight" | "orders">("weight");
  const dashboard = useQuery({
    queryKey: ["sales-dashboard-stats"],
    queryFn: async () => (await api.get("/api/analytics/sales-dashboard/")).data,
    refetchInterval: 120_000,
    staleTime: 90_000,
  });
  const range = useMemo(() => ({ date_from: iso(new Date(Date.now() - 29 * 86400000)), date_to: iso(new Date()) }), []);
  const fulfillment = useQuery({
    queryKey: ["sales-dashboard-fulfillment", range],
    queryFn: () => analyticsApi.getReportTab("sales", range),
    staleTime: 120_000,
  });

  const stats = (dashboard.data || {}) as any;
  const report = (fulfillment.data || {}) as any;
  const summary = report.summary || {};
  const metrics: any[] = Array.isArray(stats.metrics) ? stats.metrics : [];
  const loading = !dashboard.data && dashboard.isFetching;
  const trendData = useMemo(
    () => (stats.trend_data || []).map((r: any) => ({ date: r.date, orders: Number(r.orders || 0), weight: Number(r.weight || 0) })),
    [stats.trend_data],
  );
  const statusBreakdown: any[] = stats.status_breakdown || [];
  const openStatuses = statusBreakdown.filter((s) => !["COMPLETED", "CANCELLED"].includes(String(s.status)));
  const totalOpen = openStatuses.reduce((s, r) => s + Number(r.count || 0), 0);
  const pipelineWeight = String(metricOf(metrics, "Pipeline Volume")?.value || "");
  const pipelineKg = Number(pipelineWeight.replace(/[^0-9.]/g, "")) || 0;
  const draftCount = Number(statusBreakdown.find((s) => s.status === "DRAFT")?.count || 0);
  const dispatchReady = Number(metricOf(metrics, "Dispatch Ready")?.value || 0);
  const overdue = Number(metricOf(metrics, "Overdue Orders")?.value || summary.overdue_count || 0);
  // OTIF is only meaningful once orders have completed in the window.
  const otif = Number(summary.completed_count || 0) > 0 ? summary.otif_rate : undefined;
  const quotesInWindow = Number(report.quote_conversion?.total_quotes || 0);
  const otifTarget = report.benchmarks?.target_otif ?? 95;
  const alerts: any[] = stats.alerts || [];
  const forecast = stats.forecast || {};

  return (
    <div className="mx-auto max-w-[1600px] space-y-4" data-testid="sales-dashboard">
      <PageHero
        eyebrow="Commercial command"
        icon={<ShoppingCart />}
        title="Sales Command Center"
        description="Order intake, pipeline, delivery promise and customer mix — calculated live from sales orders."
        meta={
          <>
            <HeroChip tone={dashboard.isError ? "bad" : "good"}>{dashboard.isError ? "Data unavailable" : "Live"}</HeroChip>
            {stats.generated_at ? <HeroChip>Updated {relativeTime(stats.generated_at)}</HeroChip> : null}
          </>
        }
        actions={
          <>
            <Link href="/sales/orders" className={heroButtonClass("ghost")}>
              View orders <ArrowRight />
            </Link>
            <Link href="/sales/orders/create" className={heroButtonClass("primary")}>
              <Plus /> Create order
            </Link>
          </>
        }
      >
        <HeroStats columns={4}>
          <HeroStat label="Order value · 30 days" tone="info" value={summary.total_revenue !== undefined ? inrCompact(summary.total_revenue) : "—"} hint={summary.total_weight_ordered_kg !== undefined ? `${kgCompact(summary.total_weight_ordered_kg)} ordered` : "last 30 days"} />
          <HeroStat label="Open pipeline" value={pipelineKg ? kgCompact(pipelineKg) : "—"} hint={`${count(totalOpen)} open orders`} />
          <HeroStat
            label="On time in full"
            tone={otif === undefined ? "neutral" : otif >= otifTarget ? "good" : "bad"}
            value={otif === undefined ? "—" : pct(otif)}
            hint={otif === undefined ? "no completed orders yet" : `target ${pct(otifTarget, 0)}`}
          />
          <HeroStat label="Overdue orders" tone={overdue ? "bad" : "good"} value={count(overdue)} hint="past promised delivery" />
        </HeroStats>
      </PageHero>

      <StatGrid columns={4} className="erp-stagger">
        <StatCard label="Orders today" icon={<ShoppingCart />} value={Number(metricOf(metrics, "Orders Today")?.value || 0)} hint="new orders created" loading={loading} href="/sales/orders" />
        <StatCard label="Drafts to confirm" icon={<ClipboardList />} tone={draftCount ? "warn" : "neutral"} value={draftCount} hint="waiting for confirmation" loading={loading} href="/sales/orders" />
        <StatCard label="Ready to ship" icon={<PackageCheck />} tone="good" value={dispatchReady} hint="orders in Dispatch Bay" loading={loading} href="/logistics/dispatch" />
        <StatCard
          label="Quote conversion"
          icon={<Target />}
          value={quotesInWindow > 0 ? Number(summary.quote_conversion_pct || 0) : null}
          format={(v) => pct(v)}
          hint={report.quote_conversion ? `${count(report.quote_conversion.converted_quotes)} of ${count(report.quote_conversion.total_quotes)} quotes` : "quotes won"}
          loading={!fulfillment.data && fulfillment.isFetching}
          href="/sales/quotations"
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <Panel
          icon={<ShoppingCart />}
          title="Order intake · last 30 days"
          description={trendMode === "weight" ? "Ordered weight per day" : "Orders created per day"}
          actions={
            <Segmented
              size="sm"
              value={trendMode}
              onChange={setTrendMode}
              options={[
                { value: "weight", label: "Weight" },
                { value: "orders", label: "Orders" },
              ]}
            />
          }
        >
          {loading ? (
            <div className="erp-skeleton h-[250px] rounded-xl" />
          ) : trendData.some((r: any) => r.orders || r.weight) ? (
            trendMode === "weight" ? (
              <TrendArea data={trendData} xKey="date" series={[{ key: "weight", label: "Weight" }]} height={250} valueFormat={(v) => kgCompact(v)} />
            ) : (
              <Bars data={trendData} xKey="date" series={[{ key: "orders", label: "Orders" }]} height={250} valueFormat={count} />
            )
          ) : (
            <PanelEmpty title="No orders in the last 30 days" />
          )}
          {forecast.target_configured ? (
            <div className="mt-3 flex items-center justify-between rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-[12.5px]">
              <span className="text-content-3">Monthly target progress</span>
              <span className="font-semibold tabular-nums">{pct(forecast.percentage)}</span>
            </div>
          ) : null}
        </Panel>
        <Panel icon={<AlertTriangle />} title="Needs attention" description="Work waiting on the sales desk">
          {alerts.length ? (
            <ul className="space-y-2">
              {alerts.map((a: any) => (
                <li key={a.type}>
                  <Link
                    href={a.type === "dispatch" ? "/logistics/dispatch" : a.href || "/sales/orders"}
                    className="group flex items-center gap-3 rounded-xl border border-line bg-surface-1 px-3 py-3 transition hover:border-line-strong hover:bg-surface-2"
                  >
                    <span
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[14px] font-semibold tabular-nums",
                        a.type === "overdue" ? "bg-danger-bg text-danger-fg" : a.type === "draft" ? "bg-warning-bg text-warning-fg" : "bg-success-bg text-success-fg",
                      )}
                    >
                      {count(a.count)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-content-1">{a.title}</span>
                      <span className="block truncate text-[12px] text-content-3">{a.description}</span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 text-content-4 transition group-hover:text-content-1" />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <PanelEmpty title="Nothing waiting" />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel icon={<ClipboardList />} title="Order pipeline" description={`${count(totalOpen)} open orders by stage`}>
          {openStatuses.length ? (
            <div className="grid items-center gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
              <Donut
                data={openStatuses.map((s) => ({ name: sentence(s.status), value: Number(s.count || 0) }))}
                height={160}
                centerValue={count(totalOpen)}
                centerLabel="open"
                valueFormat={count}
              />
              <ul className="space-y-2 text-[12.5px]">
                {openStatuses.map((s, i) => (
                  <li key={s.status} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-content-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: vizColor(i) }} />
                      {sentence(s.status)}
                    </span>
                    <span className="tabular-nums text-content-1">{count(s.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <PanelEmpty title="No open orders" />
          )}
        </Panel>
        <Panel icon={<Crown />} title="Top customers" description="By ordered weight">
          {(stats.customer_distribution || []).length ? (
            <RankedBars
              items={(stats.customer_distribution || []).map((c: any) => ({ key: c.name, label: c.name, value: Number(c.value || 0) }))}
              valueFormat={kgCompact}
              limit={6}
            />
          ) : (
            <PanelEmpty title="No customer orders yet" />
          )}
        </Panel>
        <Panel icon={<ShoppingBag />} title="Products by value · 30 days" description="What customers are buying">
          {(report.sku_breakdown || []).length ? (
            <RankedBars
              items={(report.sku_breakdown || []).map((s: any) => ({
                key: s.sku,
                label: s.sku,
                value: Number(s.value || 0),
                sub: `${kgCompact(s.weight_kg)} · ${count(s.orders)} orders`,
              }))}
              valueFormat={inrCompact}
              limit={6}
            />
          ) : (
            <PanelEmpty title="No product sales in the last 30 days" />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel flush icon={<ClipboardList />} title="Recent orders" actions={<Link href="/sales/orders" className="text-[12.5px] font-medium text-primary hover:underline">All orders</Link>}>
          {(stats.recent_orders || []).length ? (
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-content-3">
                    <th className="px-4 py-2.5 font-medium">Order</th>
                    <th className="px-3 py-2.5 font-medium">Customer</th>
                    <th className="px-3 py-2.5 text-right font-medium">Weight</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats.recent_orders || []).map((o: any) => (
                    <tr key={o.id} className="erp-manifest-row">
                      <td className="border-t border-line px-4 py-2.5">
                        <Link href={`/sales/orders/${o.id}`} className="font-mono font-semibold text-content-1 hover:underline">
                          {o.order_number}
                        </Link>
                      </td>
                      <td className="max-w-[240px] truncate border-t border-line px-3 py-2.5 text-content-2">{o.customer}</td>
                      <td className="border-t border-line px-3 py-2.5 text-right tabular-nums">{o.weight}</td>
                      <td className="border-t border-line px-3 py-2.5">
                        <Pill tone={statusTone(String(o.status))} dot>
                          {sentence(o.status)}
                        </Pill>
                      </td>
                      <td className="border-t border-line px-4 py-2.5 text-right text-content-3">{o.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-5 pb-5">
              <PanelEmpty title="No orders yet" />
            </div>
          )}
        </Panel>
        <Panel icon={<Clock3 />} title="Most overdue" description="Promised delivery has passed" actions={<Link href="/analytics/reports/sales" className="text-[12.5px] font-medium text-primary hover:underline">Fulfillment report</Link>}>
          {(report.overdue_orders || []).length ? (
            <ul className="divide-y divide-line">
              {(report.overdue_orders || []).slice(0, 7).map((o: any) => (
                <li key={o.order_number} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="font-mono text-[12.5px] font-semibold text-content-1">{o.order_number}</div>
                    <div className="truncate text-[12px] text-content-3">
                      {o.customer_name} · due {o.delivery_date}
                    </div>
                  </div>
                  <Pill tone={Number(o.days_overdue) > 30 ? "bad" : "warn"}>{count(o.days_overdue)} days late</Pill>
                </li>
              ))}
            </ul>
          ) : (
            <PanelEmpty title="Nothing overdue" />
          )}
        </Panel>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Coins,
  Crown,
  Factory,
  FileWarning,
  GitBranch,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Truck,
} from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { GateIntelligencePanel } from "@/components/gate/gate-intelligence";
import { analyticsApi } from "@/services/analytics";
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
  RankedBars,
  Sparkline,
  StatCard,
  StatGrid,
  heroButtonClass,
  vizColor,
} from "@/components/premium";
import { Bars, Donut, TrendArea } from "@/components/premium/charts";
import { count, dayLabel, inrCompact, kgCompact, pct, relativeTime, sentence } from "@/components/premium/format";

type Timeframe = "day" | "week" | "month" | "year";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

const metricOf = (metrics: any[], id: string) => metrics.find((m) => m?.id === id);

const linkClass = "text-[12.5px] font-medium text-primary hover:underline";

export function ExecutiveDeck({
  eyebrow = "Owner Command Deck",
  title,
  testId = "owner-dashboard",
}: {
  eyebrow?: string;
  /** Fixed title; when omitted the deck greets the signed-in user. */
  title?: string;
  testId?: string;
}) {
  const { user } = useAuth();
  const [timeframe, setTimeframe] = useState<Timeframe>("month");
  const query = useQuery({
    queryKey: ["owner-control-tower", timeframe],
    queryFn: () => analyticsApi.getControlTowerStats(timeframe),
    staleTime: 60_000,
    refetchInterval: 120_000,
    placeholderData: (previous) => previous,
  });
  const data = (query.data || {}) as any;
  const metrics: any[] = Array.isArray(data.metrics) ? data.metrics : [];
  const loading = !query.data && query.isFetching;

  const revenue = metricOf(metrics, "revenue");
  const margin = metricOf(metrics, "net_profit");
  const production = metricOf(metrics, "production");
  const inventory = metricOf(metrics, "inventory");
  const utilization = metricOf(metrics, "machine_utilization");
  const scrap = metricOf(metrics, "scrap_mtd");
  const costCoverage = metricOf(metrics, "actual_cost_coverage");
  const fin = data.financial_summary || {};
  const orderHealth = data.order_health || {};
  const procurement = data.procurement || {};
  const trading = data.trading || {};
  const pod = data.pod_kpis || {};
  const reuse = data.route_reuse_mix || {};
  const material = data.material_control || {};
  const ink = data.ink_control || {};
  const producedKg = Number(production?.value || 0);
  const scrapKg = Number(scrap?.value || 0);
  const scrapRate = producedKg + scrapKg > 0 ? (scrapKg / (producedKg + scrapKg)) * 100 : null;

  const financialTrend = useMemo(
    () =>
      (Array.isArray(data.financial_trend) ? data.financial_trend : []).map((row: any) => {
        const start = String(row.period || "").split("→")[0].trim();
        const d = new Date(`${start}T00:00:00`);
        return {
          label: Number.isNaN(d.getTime()) ? start : d.toLocaleDateString("en-IN", { month: "short" }),
          revenue: Number(row.revenue || 0),
          cogs: Number(row.total_cogs || 0),
        };
      }),
    [data.financial_trend],
  );
  const financeHasValues = financialTrend.some((r: any) => r.revenue || r.cogs);
  const productionTrend = useMemo(() => {
    const prod = new Map<string, number>((data.production_trend || []).map((r: any) => [String(r.date), Number(r.count || 0)]));
    const scr = new Map<string, number>((data.scrap_trend || []).map((r: any) => [String(r.date), Number(r.count || 0)]));
    const out = [];
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 86400000);
      const key = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      out.push({ date: key, output: prod.get(key) || 0, scrap: scr.get(key) || 0 });
    }
    return out;
  }, [data.production_trend, data.scrap_trend]);
  const salesTrend = useMemo(
    () => (data.sales_trend || []).map((r: any) => ({ date: String(r.date), orders: Number(r.count || 0) })),
    [data.sales_trend],
  );

  const orderParts = [
    { label: "Draft", value: Number(orderHealth.draft_count || 0) },
    { label: "Needs planning", value: Number(orderHealth.planning_required_count || 0) },
    { label: "Packing ready", value: Number(orderHealth.packing_ready_count || 0) },
    { label: "Dispatch ready", value: Number(orderHealth.dispatch_ready_count || 0) },
  ];
  const inventoryKg = (data.inventory_distribution || []).filter((r: any) => String(r.unit || "").toUpperCase() === "KG");
  const inventoryOther = (data.inventory_distribution || []).filter((r: any) => String(r.unit || "").toUpperCase() !== "KG");
  const jobDist: any[] = data.job_distribution || [];
  const alerts: any[] = [...(data.risk_signals || []).map((r: any) => ({ ...r, type: "RISK" })), ...(data.alerts || [])];

  return (
    <div className="mx-auto max-w-[1600px] space-y-4" data-testid={testId}>
      <PageHero
        eyebrow={eyebrow}
        icon={<Crown />}
        title={title || `${greeting()}${user?.first_name ? `, ${user.first_name}` : ""}`}
        description="Money, output, stock and risk across every plant — live from sales, production, inventory and costing."
        meta={
          <>
            <HeroChip tone={query.isError ? "bad" : "good"}>{query.isError ? "Data unavailable" : "Live"}</HeroChip>
            {fin.period ? <HeroChip>{fin.period}</HeroChip> : null}
            {data.generated_at ? <HeroChip>Updated {relativeTime(data.generated_at)}</HeroChip> : null}
          </>
        }
        actions={
          <>
            <div className="rounded-xl border border-white/15 bg-white/[0.06] p-0.5" role="group" aria-label="Timeframe">
              {(["day", "week", "month", "year"] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  aria-pressed={timeframe === tf}
                  className={cn(
                    "rounded-[10px] px-3 py-1.5 text-[12.5px] font-medium capitalize transition",
                    timeframe === tf ? "bg-white text-[#0b1122]" : "text-white/75 hover:text-white",
                  )}
                >
                  {tf}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => void query.refetch()} className={heroButtonClass("ghost")} disabled={query.isFetching}>
              <RefreshCw className={cn(query.isFetching && "animate-spin motion-reduce:animate-none")} /> Refresh
            </button>
          </>
        }
      >
        <HeroStats columns={4}>
          <HeroStat label="Booked order value" tone="info" value={revenue ? inrCompact(revenue.value) : "—"} hint={revenue?.sub_value} />
          <HeroStat
            label="Gross margin"
            tone={fin.gross_margin_pct >= 25 ? "good" : fin.gross_margin_pct > 0 ? "warn" : "neutral"}
            value={fin.revenue ? pct(fin.gross_margin_pct) : "Pending"}
            hint={fin.revenue ? `${inrCompact(fin.gross_profit)} gross profit` : margin?.sub_value || "actual costing not posted"}
          />
          <HeroStat label="Production output" value={production ? kgCompact(production.value) : "—"} hint={production?.sub_value} />
          <HeroStat
            label="Overdue orders"
            tone={Number(orderHealth.overdue_count) ? "bad" : "good"}
            value={count(orderHealth.overdue_count ?? 0)}
            hint="past promised delivery"
          />
        </HeroStats>
      </PageHero>

      <StatGrid columns={4} className="erp-stagger">
        <StatCard
          label="Inventory on hand"
          icon={<Boxes />}
          value={Number(inventory?.value ?? 0)}
          format={kgCompact}
          hint={inventory?.estimated_value_inr ? `≈ ${inrCompact(inventory.estimated_value_inr)} rated value` : inventory?.sub_value}
          href="/inventory"
          loading={loading}
        />
        <StatCard
          label="Scrap"
          icon={<AlertTriangle />}
          tone={scrapRate !== null && scrapRate > 5 ? "bad" : "neutral"}
          value={scrapKg}
          format={kgCompact}
          hint={scrapRate !== null ? `${pct(scrapRate)} of processed` : "waste generated"}
          trend={productionTrend.map((r) => r.scrap)}
          href="/analytics/reports/scrap"
          loading={loading}
        />
        <StatCard
          label="Machine utilisation"
          icon={<Factory />}
          value={Number(utilization?.value ?? 0)}
          format={(v) => pct(v)}
          hint={utilization?.sub_value}
          href="/analytics/reports/oee"
          loading={loading}
        />
        <StatCard
          label="Actual-cost coverage"
          icon={<Coins />}
          tone={Number(costCoverage?.value) >= 80 ? "good" : "warn"}
          value={Number(costCoverage?.value ?? 0)}
          format={(v) => pct(v)}
          hint={costCoverage?.sub_value}
          href="/analytics/costing"
          loading={loading}
        />
      </StatGrid>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
        <Panel
          icon={<Factory />}
          title="Production · last 30 days"
          description="Daily good output from machine logs"
          actions={<Link href="/analytics/reports/production" className={linkClass}>Full report</Link>}
        >
          {loading ? (
            <div className="erp-skeleton h-[250px] rounded-xl" />
          ) : productionTrend.some((r) => r.output) ? (
            <TrendArea data={productionTrend} xKey="date" series={[{ key: "output", label: "Output" }]} height={250} xFormat={dayLabel} valueFormat={(v) => kgCompact(v)} />
          ) : (
            <PanelEmpty title="No production logged in the last 30 days" />
          )}
        </Panel>
        <Panel icon={<Coins />} title="Profit & loss" description={fin.period || "Selected period"} actions={<Link href="/analytics/costing" className={linkClass}>Costing centre</Link>}>
          <dl className="space-y-2 text-[13px]">
            {[
              { label: "Revenue", value: fin.revenue, strong: true },
              { label: "Material cost", value: -Number(fin.cogs_material || 0) },
              { label: "Conversion cost", value: -Number(fin.cogs_conversion || 0) },
              { label: "Absorbed overhead", value: -Number(fin.absorbed_overhead || 0) },
              { label: "Gross profit", value: fin.gross_profit, strong: true, divider: true },
              { label: "Unabsorbed overheads", value: -Number(fin.overheads?.unabsorbed_pool_value || 0) },
              { label: "Net profit", value: fin.net_profit, strong: true, divider: true },
            ].map((row) => (
              <div key={row.label} className={cn("flex items-baseline justify-between gap-3", row.divider && "border-t border-line pt-2")}>
                <dt className={row.strong ? "font-medium text-content-1" : "text-content-3"}>{row.label}</dt>
                <dd className={cn("tabular-nums", row.strong ? "font-semibold text-content-1" : "text-content-2")}>{inrCompact(row.value || 0)}</dd>
              </div>
            ))}
          </dl>
          {fin.coverage && !fin.coverage.cost_data_ready ? (
            <div className="mt-3 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[12px] text-warning-fg">
              Margins firm up as actual order costs are posted · {count(fin.coverage.cost_row_count || 0)} of {count(fin.coverage.sales_line_count || 0)} lines costed.
            </div>
          ) : (
            <div className="mt-3">
              <Meter label="Gross margin" value={Number(fin.gross_margin_pct || 0)} max={40} display={pct(fin.gross_margin_pct)} tone={fin.gross_margin_pct >= 25 ? "good" : "warn"} />
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel icon={<Coins />} title="Six-month financials" description="Revenue against cost of goods">
          {financeHasValues ? (
            <Bars
              data={financialTrend}
              xKey="label"
              series={[
                { key: "revenue", label: "Revenue", color: vizColor(0) },
                { key: "cogs", label: "Cost of goods", color: vizColor(1) },
              ]}
              height={230}
              valueFormat={(v) => inrCompact(v)}
            />
          ) : (
            <PanelEmpty title="No costed revenue in the last six months" />
          )}
        </Panel>
        <Panel
          icon={<ShoppingCart />}
          title="Order book health"
          description={`${count(orderParts.reduce((s, p) => s + p.value, 0))} open orders by stage`}
          actions={<Link href="/sales/orders" className={linkClass}>Orders</Link>}
        >
          <CompositionBar parts={orderParts} valueFormat={count} />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Link href="/sales/orders" className="rounded-xl border border-danger-border bg-danger-bg px-3 py-2.5 transition hover:brightness-[0.98]">
              <div className="text-[11.5px] text-danger-fg">Overdue</div>
              <div className="text-[20px] font-semibold tabular-nums text-danger-fg">{count(orderHealth.overdue_count ?? 0)}</div>
            </Link>
            <Link href="/logistics/dispatch" className="rounded-xl border border-success-border bg-success-bg px-3 py-2.5 transition hover:brightness-[0.98]">
              <div className="text-[11.5px] text-success-fg">Ready to ship</div>
              <div className="text-[20px] font-semibold tabular-nums text-success-fg">{count(orderHealth.dispatch_ready_count ?? 0)}</div>
            </Link>
          </div>
        </Panel>
        <Panel icon={<Crown />} title="Top customers" description="By ordered weight">
          {(data.top_customers || []).length ? (
            <RankedBars
              items={(data.top_customers || []).map((c: any) => ({
                key: c.customer_name,
                label: c.customer_name || "Unknown",
                value: Number(c.total_weight || 0),
                sub: `${count(c.order_count)} orders`,
              }))}
              valueFormat={kgCompact}
              limit={5}
            />
          ) : (
            <PanelEmpty title="No customer orders yet" />
          )}
        </Panel>
        <Panel icon={<ShoppingBag />} title="SKU Performance" description="Top products ordered in the last 30 days">
          {(data.sku_performance || []).length ? (
            <RankedBars
              items={(data.sku_performance || []).map((s: any) => ({
                key: s.sku_name,
                label: s.sku_name,
                value: Number(s.weight_kg || 0),
                sub: `${count(s.orders)} orders${Number(s.repeat_orders) ? ` · ${count(s.repeat_orders)} repeat` : ""}`,
              }))}
              valueFormat={kgCompact}
              limit={6}
            />
          ) : (
            <PanelEmpty title="No SKU orders in the last 30 days" />
          )}
        </Panel>
        <Panel icon={<Boxes />} title="Stock position" description="Weight on hand by stage">
          {inventoryKg.length ? (
            <div className="grid items-center gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
              <Donut
                data={inventoryKg.map((r: any) => ({ name: r.name, value: Number(r.value || 0) }))}
                height={160}
                centerValue={kgCompact(inventoryKg.reduce((s: number, r: any) => s + Number(r.value || 0), 0))}
                centerLabel="on hand"
                valueFormat={kgCompact}
              />
              <ul className="space-y-2 text-[12.5px]">
                {inventoryKg.map((r: any, i: number) => (
                  <li key={r.name} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-content-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: vizColor(i) }} />
                      <span className="truncate">{r.name}</span>
                    </span>
                    <span className="tabular-nums text-content-1">{kgCompact(r.value)}</span>
                  </li>
                ))}
                {inventoryOther.map((r: any) => (
                  <li key={r.name} className="flex items-center justify-between gap-2 border-t border-line pt-2 text-content-3">
                    <span className="truncate">{r.name}</span>
                    <span className="tabular-nums">{count(r.value)} units</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <PanelEmpty title="No stock recorded" />
          )}
        </Panel>
        <Panel icon={<PackageCheck />} title="Job status" description="All production jobs by state">
          {jobDist.length ? (
            <div className="grid items-center gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
              <Donut
                data={jobDist.map((j: any) => ({ name: sentence(j.job_state), value: Number(j.count || 0) }))}
                height={160}
                centerValue={count(jobDist.reduce((s: number, j: any) => s + Number(j.count || 0), 0))}
                centerLabel="jobs"
                valueFormat={count}
              />
              <ul className="space-y-2 text-[12.5px]">
                {jobDist.map((j: any, i: number) => (
                  <li key={j.job_state} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-content-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: vizColor(i) }} />
                      {sentence(j.job_state)}
                    </span>
                    <span className="tabular-nums text-content-1">{count(j.count)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <PanelEmpty title="No jobs yet" />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
        <Panel icon={<GitBranch />} title="Material discipline" description="Issued vs theoretical this period">
          {material.data_ready ? (
            <div className="space-y-3">
              <Meter label="Issue discipline" value={Math.min(150, Number(material.issue_discipline_pct || 0))} max={150} display={pct(material.issue_discipline_pct)} tone={material.issue_discipline_pct > 110 ? "bad" : "good"} />
              <Meter label="Return efficiency" value={Number(material.return_efficiency_pct || 0)} max={100} display={pct(material.return_efficiency_pct)} />
              <Meter label="Variance vs theoretical" value={Math.abs(Number(material.variance_pct || 0))} max={30} display={pct(material.variance_pct)} tone={Math.abs(material.variance_pct) > 12 ? "bad" : "good"} />
            </div>
          ) : (
            <PanelEmpty title="Waiting for material postings">{material.data_quality_note}</PanelEmpty>
          )}
        </Panel>
        <Panel icon={<Sparkles />} title="Ink control" description="Issued, returned and remixed">
          {ink.data_ready ? (
            <div className="space-y-3">
              <Meter label="Consumed" value={Number(ink.consumed_kg || 0)} max={Math.max(1, Number(ink.issued_kg || 0))} display={kgCompact(ink.consumed_kg)} />
              <Meter label="Returned" value={Number(ink.returned_kg || 0)} max={Math.max(1, Number(ink.issued_kg || 0))} display={kgCompact(ink.returned_kg)} />
              <Meter label="Remix ratio" value={Number(ink.remix_ratio_pct || 0)} max={100} display={pct(ink.remix_ratio_pct)} tone={ink.remix_ratio_pct > 30 ? "warn" : "good"} />
            </div>
          ) : (
            <PanelEmpty title="Waiting for ink postings">{ink.data_quality_note}</PanelEmpty>
          )}
        </Panel>
        <Panel icon={<Boxes />} title="POD Intelligence" description="Print-on-demand stock programme">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Active SKUs", value: pod.active_pod_skus },
              { label: "Variants", value: pod.active_pod_variants },
              { label: "Bulk orders", value: pod.bulk_orders },
              { label: "Bulk target", value: pod.bulk_target_kg, kg: true },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
                <div className="text-[11.5px] text-content-3">{item.label}</div>
                <div className="text-[18px] font-semibold tabular-nums text-content-1">{item.kg ? kgCompact(item.value || 0) : count(item.value || 0)}</div>
              </div>
            ))}
          </div>
        </Panel>
        <Panel icon={<GitBranch />} title="Route Reuse Pools" description="Roll stock available for reuse routing">
          <RankedBars
            items={[
              { key: "final", label: "Final roll pool", value: Number(reuse.final_roll_kg || 0) },
              { key: "invariant", label: "Invariant pool", value: Number(reuse.invariant_roll_kg || 0) },
              { key: "upstream", label: "Upstream pool", value: Number(reuse.upstream_roll_kg || 0) },
            ]}
            valueFormat={kgCompact}
            colorByIndex
          />
          <div className="mt-3 text-[12px] text-content-3">{count(reuse.fg_batch_count || 0)} finished-goods batches in stock</div>
        </Panel>
      </div>

      {data.gate ? (
        <GateIntelligencePanel
          gate={data.gate}
          periodLabel={timeframe === "day" ? "today" : timeframe === "week" ? "last 7 days" : timeframe === "year" ? "this year" : "this month"}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel icon={<ShoppingCart />} title="New orders · last 30 days" description="Orders created per day">
          {salesTrend.length ? (
            <Bars data={salesTrend} xKey="date" series={[{ key: "orders", label: "Orders" }]} height={200} xFormat={dayLabel} valueFormat={count} />
          ) : (
            <PanelEmpty title="No new orders in the last 30 days" />
          )}
        </Panel>
        <Panel icon={<Truck />} title="Procurement" description="Open purchase orders" actions={<Link href="/procurement/purchase-orders" className={linkClass}>Purchase orders</Link>}>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
              <div className="text-[11.5px] text-content-3">Open POs</div>
              <div className="text-[18px] font-semibold tabular-nums">{count(procurement.open_pos_count || 0)}</div>
              <div className="text-[11.5px] text-content-3">{inrCompact(procurement.open_po_value_inr || 0)}</div>
            </div>
            <div className={cn("rounded-xl border px-3 py-2.5", Number(procurement.overdue_pos_count) ? "border-danger-border bg-danger-bg" : "border-line bg-surface-2/60")}>
              <div className="text-[11.5px] text-content-3">Overdue POs</div>
              <div className="text-[18px] font-semibold tabular-nums">{count(procurement.overdue_pos_count || 0)}</div>
              <div className="text-[11.5px] text-content-3">avg cycle {count(procurement.avg_cycle_days || 0)} d</div>
            </div>
          </div>
          <div className="mt-3 flex items-baseline justify-between text-[12.5px]">
            <span className="text-content-3">Spend this month</span>
            <span className="font-semibold tabular-nums">{inrCompact(procurement.mtd_spend_inr || 0)}</span>
          </div>
          {(procurement.top_vendors || []).length ? (
            <RankedBars
              className="mt-3"
              items={(procurement.top_vendors || []).map((v: any, i: number) => ({
                key: String(v.vendor_id || v.name || i),
                label: v.name || v.vendor_name || v.vendor || "Vendor",
                value: Number(v.value_inr || v.spend_inr || v.value || 0),
              }))}
              valueFormat={inrCompact}
              limit={4}
            />
          ) : null}
        </Panel>
        <Panel icon={<Sparkles />} title="Trading" description="Trading goods and sellable materials" actions={<Link href="/analytics/reports/trading" className={linkClass}>Trading pulse</Link>}>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[11.5px] text-content-3">Revenue this month</div>
              <div className="text-[22px] font-semibold tabular-nums">{inrCompact(trading.trade_revenue_mtd_inr || 0)}</div>
              <div className="text-[12px] text-content-3">
                margin {pct(trading.trade_margin_pct || 0)} · {count(trading.open_trade_orders || 0)} open orders
              </div>
            </div>
            <Sparkline data={(trading.trade_revenue_series || []).map((r: any) => Number(r.revenue_inr || 0))} className="h-12 w-28" />
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3 text-[12.5px]">
            <span className="text-content-3">Tradeable stock value</span>
            <span className="font-semibold tabular-nums">{inrCompact(trading.trading_stock_value_inr || 0)}</span>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel icon={<Factory />} title="Live floor activity" description="Jobs executing right now" actions={<Link href="/dashboard/planner/control-tower/live-production" className={linkClass}>Live production</Link>}>
          {(data.active_jobs || []).length ? (
            <ul className="divide-y divide-line">
              {(data.active_jobs || []).slice(0, 6).map((job: any) => (
                <li key={job.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center justify-between gap-3">
                    <Link href={`/production/jobs/${job.id}`} className="min-w-0 truncate font-mono text-[12.5px] font-semibold text-content-1 hover:underline">
                      {job.job_number}
                    </Link>
                    <span className="shrink-0 text-[12px] tabular-nums text-content-2">{count(job.progress)}%</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-content-3">
                    {job.product} · {job.operator}
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-[var(--viz-1)]" style={{ width: `${Math.min(100, Number(job.progress) || 0)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <PanelEmpty title="No jobs executing right now" />
          )}
        </Panel>
        <Panel icon={<Factory />} title="Shift output & quality" description="This period, by shift">
          {(data.shift_oee || []).length ? (
            <RankedBars
              items={(data.shift_oee || []).map((row: any) => ({
                key: row.shift_code,
                label: `Shift ${row.shift_code}`,
                value: Number(row.output_kg || 0),
                sub: `quality ${pct(row.quality_pct)} · scrap ${kgCompact(row.scrap_kg)}`,
              }))}
              valueFormat={kgCompact}
              colorByIndex
            />
          ) : (
            <PanelEmpty title="No shift-tagged output this period" />
          )}
        </Panel>
      </div>

      <Panel icon={<FileWarning />} title="Alerts & risk signals" description="What needs an owner's attention" actions={<span className="text-[12px] text-content-3">{alerts.length} open</span>}>
        {alerts.length ? (
          <ul className="grid gap-2 md:grid-cols-2">
            {alerts.slice(0, 10).map((a: any, i: number) => {
              const sev = String(a.severity || "").toUpperCase();
              return (
                <li key={a.id || a.code || i} className="flex items-start gap-3 rounded-xl border border-line bg-surface-1 px-3 py-2.5">
                  <span
                    className={cn(
                      "mt-1 h-2 w-2 shrink-0 rounded-full",
                      sev === "HIGH" || sev === "CRITICAL" ? "bg-[var(--viz-critical)]" : sev === "MEDIUM" ? "bg-[var(--viz-warning)]" : "bg-[var(--viz-1)]",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] leading-snug text-content-1">{a.message}</div>
                    <div className="mt-0.5 text-[11px] text-content-3">
                      {sentence(a.type)} · {sentence(sev)}
                      {a.timestamp ? ` · ${relativeTime(a.timestamp)}` : ""}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <PanelEmpty title="All clear">No open alerts or risk signals.</PanelEmpty>
        )}
      </Panel>

      <div className="flex flex-wrap gap-2 pb-2">
        {[
          { href: "/analytics/reports", label: "Reports Hub" },
          { href: "/analytics/costing", label: "Costing centre" },
          { href: "/logistics/dispatch", label: "Dispatch Bay" },
          { href: "/inventory", label: "Inventory" },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-1 px-3 py-1.5 text-[12.5px] font-medium text-content-2 hover:border-line-strong hover:text-content-1">
            {l.label} <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}

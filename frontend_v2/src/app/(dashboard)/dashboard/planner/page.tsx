"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Gauge,
  Layers,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Workflow,
} from "lucide-react";

import { analyticsApi } from "@/services/analytics";
import styles from "./planner.module.css";

function fmt(value: unknown, decimals = 0) {
  if (value === null || value === undefined) return "—";
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return parsed.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function pct(part: number, total: number) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (part / total) * 100));
}

function Counter({
  value,
  decimals = 0,
}: {
  value: number;
  decimals?: number;
}) {
  const [display, setDisplay] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    const start = display;
    const end = value;
    const duration = 650;
    const t0 = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - t0) / duration, 1);
      setDisplay(start + (end - start) * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };

    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <>{display.toLocaleString("en-IN", { maximumFractionDigits: decimals })}</>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
  suffix,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "sky" | "emerald" | "amber" | "violet" | "rose" | "teal";
  suffix?: string;
}) {
  return (
    <div className={styles.metricCard}>
      <div className={styles.metricHeader}>
        <span className={styles.metricLabel}>{label}</span>
        <span
          className={`${styles.metricTone} ${styles[`tone${tone[0].toUpperCase()}${tone.slice(1)}`]}`}
        />
      </div>
      <div className={styles.metricValue}>
        <Counter value={value} decimals={suffix === " KG" ? 1 : 0} />
        {suffix || ""}
      </div>
      <div className={styles.metricDetail}>{detail}</div>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.chartTooltip}>
      <div className={styles.chartTooltipLabel}>{label}</div>
      {payload.map((item: any, index: number) => (
        <div key={index} className={styles.chartTooltipItem}>
          <span style={{ color: item.color }}>{item.name}</span>
          <strong>{fmt(item.value, 1)}</strong>
        </div>
      ))}
    </div>
  );
}

const PIE_COLORS = [
  "#111827",
  "#2563eb",
  "#14b8a6",
  "#f59e0b",
  "#60a5fa",
  "#ef4444",
];

export default function PlannerDashboardPage() {
  const [countdown, setCountdown] = useState(120);

  const query = useQuery({
    queryKey: ["planner-dashboard-v2"],
    queryFn: () => analyticsApi.getPlannerDashboard(),
    refetchInterval: 120_000,
    staleTime: 90_000,
  });

  useEffect(() => {
    setCountdown(120);
    const interval = setInterval(
      () => setCountdown((current) => (current <= 1 ? 120 : current - 1)),
      1000,
    );
    return () => clearInterval(interval);
  }, [query.dataUpdatedAt]);

  const data = query.data ?? {};
  const queueKpis = data.queue_kpis ?? {};
  const statusStrip = data.status_strip ?? {};
  const productionTrend = Array.isArray(data.production_trend)
    ? data.production_trend
    : [];
  const alerts = Array.isArray(data.alerts) ? data.alerts : [];
  const recentActivity = Array.isArray(data.recent_activity)
    ? data.recent_activity
    : [];
  const demandPipeline = Array.isArray(data.demand_pipeline)
    ? data.demand_pipeline
    : [];
  const jobDistribution = Array.isArray(data.job_distribution)
    ? data.job_distribution
    : [];
  const wcCapacity = Array.isArray(data.wc_capacity) ? data.wc_capacity : [];
  const sourceMix = data.source_mix ?? {};
  const replenishmentMix = data.replenishment_mix ?? {};
  const costingSummary = data.costing_summary ?? {};

  const productionTrendData = useMemo(
    () =>
      productionTrend.map((row: any) => ({
        date: String(row.date || "").slice(5),
        output_kg: Number(row.output_kg || 0),
      })),
    [productionTrend],
  );
  const productionTrendTotal = useMemo(
    () =>
      productionTrendData.reduce(
        (sum: number, row: { output_kg: number }) => sum + row.output_kg,
        0,
      ),
    [productionTrendData],
  );

  const queueByPath = useMemo(() => {
    const fg = Number(sourceMix.fg_batch_count || 0);
    const invariant = Number(sourceMix.invariant_roll_kg || 0);
    const upstream = Number(sourceMix.upstream_roll_kg || 0);
    return [
      { label: "Final Roll Pool", value: fg, display: `${fmt(fg)} batches` },
      {
        label: "Invariant Pool",
        value: invariant,
        display: `${fmt(invariant, 1)} KG`,
      },
      {
        label: "Upstream Pool",
        value: upstream,
        display: `${fmt(upstream, 1)} KG`,
      },
    ];
  }, [sourceMix]);

  const outputMix = useMemo(
    () => [
      { name: "FG", value: Number(sourceMix.fg_batch_count || 0) || 0.0001 },
      {
        name: "Invariant",
        value: Number(sourceMix.invariant_roll_kg || 0) || 0.0001,
      },
      { name: "WIP", value: Number(sourceMix.upstream_roll_kg || 0) || 0.0001 },
      {
        name: "POD",
        value: Number(replenishmentMix.pod_bulk_open || 0) || 0.0001,
      },
      {
        name: "Packaging",
        value: Number(replenishmentMix.packaging_open || 0) || 0.0001,
      },
    ],
    [replenishmentMix, sourceMix],
  );

  const readiness = useMemo(() => {
    const ready = Number(queueKpis.ready_released || 0);
    const blocked = Number(queueKpis.blocked_count || 0);
    const artwork = alerts
      .filter((item: any) =>
        String(item.type || "")
          .toUpperCase()
          .includes("ARTWORK"),
      )
      .reduce((sum: number, item: any) => sum + Number(item.count || 0), 0);
    const total = ready + blocked + artwork;
    return { ready, blocked, artwork, total };
  }, [alerts, queueKpis]);

  const duePressure = useMemo(
    () => [
      { label: "Overdue", value: Number(statusStrip.overdue_count || 0) },
      { label: "Due today", value: Number(statusStrip.due_today_count || 0) },
      { label: "Planning queue", value: Number(queueKpis.planning_queue || 0) },
    ],
    [queueKpis, statusStrip],
  );

  const workCenterRows = useMemo(
    () =>
      [...wcCapacity]
        .sort(
          (left: any, right: any) =>
            Number(right.pending_jobs || 0) - Number(left.pending_jobs || 0),
        )
        .slice(0, 10),
    [wcCapacity],
  );

  const recentRows = recentActivity.slice(0, 8);
  const demandRows = demandPipeline.slice(0, 8);
  const coveragePct = Number(queueKpis.coverage_pct || 0);
  const costCoverage = Number(costingSummary.avg_actual_cost_coverage_pct || 0);
  const actualCount = Number(costingSummary.actual_count || 0);
  const hybridCount = Number(costingSummary.hybrid_count || 0);
  const estimatedCount = Number(costingSummary.estimated_count || 0);

  const isLoading = query.isLoading || query.isFetching;

  return (
    <div className={styles.shell}>
      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}>
            <Sparkles className="h-3.5 w-3.5" />
            Planner Command Center
          </div>
          <h1 className={styles.title}>
            Contained planner analytics for release, replenishment, and route
            pressure.
          </h1>
          <p className={styles.description}>
            Watch queue health, output mix, capacity, and readiness without
            letting the page sprawl into another report.
          </p>
        </div>
        <div className={styles.heroMeta}>
          <div className={styles.liveBadge}>
            <span className={styles.liveDot} />
            Refresh in {countdown}s
          </div>
          <button
            className={styles.refreshButton}
            onClick={() => query.refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={isLoading ? styles.spin : ""} size={14} />
            Refresh
          </button>
        </div>
      </section>

      <section className={styles.metricGrid}>
        <MetricCard
          label="Planning queue"
          value={Number(queueKpis.planning_queue || 0)}
          detail="Rows waiting for planner action"
          tone="sky"
        />
        <MetricCard
          label="Ready / released"
          value={Number(queueKpis.ready_released || 0)}
          detail="Rows already releaseable"
          tone="emerald"
        />
        <MetricCard
          label="Blocked rows"
          value={Number(queueKpis.blocked_count || 0)}
          detail="Queue rows with blockers or hold state"
          tone="amber"
        />
        <MetricCard
          label="Required demand"
          value={Number(queueKpis.required_kg || 0)}
          detail="Planner queue weight still to satisfy"
          tone="violet"
          suffix=" KG"
        />
        <MetricCard
          label="Allocatable stock"
          value={Number(queueKpis.allocatable_kg || 0)}
          detail="Inventory immediately visible to planner"
          tone="teal"
          suffix=" KG"
        />
        <MetricCard
          label="Coverage"
          value={coveragePct}
          detail={`${fmt(Number(statusStrip.free_machine_slots || 0))} free machine slots`}
          tone={
            coveragePct >= 80 ? "emerald" : coveragePct >= 40 ? "amber" : "rose"
          }
          suffix="%"
        />
      </section>

      <section className={styles.dashboardGrid}>
        <div className={styles.mainColumn}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.sectionEyebrow}>Output trend</div>
                <h2 className={styles.panelTitle}>
                  Thirty-day production rhythm
                </h2>
              </div>
              <div className={styles.panelStat}>
                {fmt(productionTrendTotal, 1)} KG
              </div>
            </div>
            <div className={styles.chartBox}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={productionTrendData}
                  margin={{ top: 12, right: 6, left: -18, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="plannerArea"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="#2563eb"
                        stopOpacity={0.22}
                      />
                      <stop
                        offset="95%"
                        stopColor="#2563eb"
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="output_kg"
                    name="Output KG"
                    stroke="#111827"
                    fill="url(#plannerArea)"
                    strokeWidth={2.2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className={styles.doubleGrid}>
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Source path</div>
                  <h2 className={styles.panelTitle}>
                    Planner-visible source pools
                  </h2>
                </div>
                <Workflow className={styles.panelIcon} />
              </div>
              <div className={styles.stackList}>
                {queueByPath.map((item) => (
                  <div key={item.label} className={styles.stackRow}>
                    <div className={styles.stackRowHeader}>
                      <span>{item.label}</span>
                      <span>{item.display}</span>
                    </div>
                    <div className={styles.stackTrack}>
                      <div
                        className={styles.stackFill}
                        style={{
                          width: `${pct(item.value, Math.max(...queueByPath.map((entry) => entry.value), 1))}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Output class</div>
                  <h2 className={styles.panelTitle}>Planner stock mix</h2>
                </div>
                <Boxes className={styles.panelIcon} />
              </div>
              <div className={styles.pieWrap}>
                <div className={styles.pieChart}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={outputMix}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={42}
                        outerRadius={66}
                        paddingAngle={3}
                      >
                        {outputMix.map((entry, index) => (
                          <Cell
                            key={entry.name}
                            fill={PIE_COLORS[index % PIE_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className={styles.legendList}>
                  {outputMix.map((entry, index) => (
                    <div key={entry.name} className={styles.legendRow}>
                      <span
                        className={styles.legendDot}
                        style={{
                          background: PIE_COLORS[index % PIE_COLORS.length],
                        }}
                      />
                      <span className={styles.legendLabel}>{entry.name}</span>
                      <span className={styles.legendValue}>
                        {fmt(
                          entry.value,
                          entry.name === "Invariant" || entry.name === "WIP"
                            ? 1
                            : 0,
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.doubleGrid}>
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Work center load</div>
                  <h2 className={styles.panelTitle}>Capacity pressure</h2>
                </div>
                <Gauge className={styles.panelIcon} />
              </div>
              <div className={styles.scrollPanel}>
                {workCenterRows.length ? (
                  workCenterRows.map((row: any) => (
                    <div
                      key={row.wc_id || row.wc_name}
                      className={styles.capacityRow}
                    >
                      <div className={styles.capacityHeader}>
                        <span className={styles.capacityName}>
                          {row.wc_name}
                        </span>
                        <span className={styles.capacityMeta}>
                          {fmt(row.utilization)}% · {fmt(row.running)}/
                          {fmt(row.machine_count)}
                        </span>
                      </div>
                      <div className={styles.capacityTrack}>
                        <div
                          className={styles.capacityFill}
                          style={{
                            width: `${Math.min(100, Number(row.utilization || 0))}%`,
                          }}
                        />
                      </div>
                      <div className={styles.capacitySub}>
                        Pending jobs {fmt(row.pending_jobs || 0)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className={styles.emptyState}>
                    No work-center telemetry
                  </div>
                )}
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Demand pressure</div>
                  <h2 className={styles.panelTitle}>Due and queue risk</h2>
                </div>
                <CalendarClock className={styles.panelIcon} />
              </div>
              <div className={styles.miniBars}>
                {duePressure.map((item, index) => (
                  <div key={item.label} className={styles.miniBarCard}>
                    <div className={styles.miniBarHead}>
                      <span>{item.label}</span>
                      <strong>{fmt(item.value)}</strong>
                    </div>
                    <div className={styles.miniBarTrack}>
                      <div
                        className={styles.miniBarFill}
                        style={{
                          width: `${pct(item.value, Math.max(...duePressure.map((entry) => entry.value), 1))}%`,
                          background: PIE_COLORS[index % PIE_COLORS.length],
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.readinessCard}>
                <div className={styles.readinessHeader}>
                  <div>
                    <div className={styles.sectionEyebrow}>
                      Release readiness
                    </div>
                    <h3 className={styles.readinessTitle}>Queue state split</h3>
                  </div>
                  <ShieldCheck className={styles.panelIcon} />
                </div>
                <div className={styles.readinessBar}>
                  <span
                    className={styles.readySegment}
                    style={{
                      width: `${pct(readiness.ready, readiness.total || 1)}%`,
                    }}
                  />
                  <span
                    className={styles.blockedSegment}
                    style={{
                      width: `${pct(readiness.blocked, readiness.total || 1)}%`,
                    }}
                  />
                  <span
                    className={styles.artworkSegment}
                    style={{
                      width: `${pct(readiness.artwork, readiness.total || 1)}%`,
                    }}
                  />
                </div>
                <div className={styles.readinessLegend}>
                  <span>Ready {fmt(readiness.ready)}</span>
                  <span>Blocked {fmt(readiness.blocked)}</span>
                  <span>Artwork {fmt(readiness.artwork)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className={styles.doubleGrid}>
            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>Demand</div>
                  <h2 className={styles.panelTitle}>Upcoming sales pull</h2>
                </div>
                <ClipboardList className={styles.panelIcon} />
              </div>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Template</th>
                      <th>Pending</th>
                      <th>Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {demandRows.length ? (
                      demandRows.map((row: any) => (
                        <tr key={`${row.so_number}-${row.template_name}`}>
                          <td>{row.so_number}</td>
                          <td>{row.customer}</td>
                          <td>{row.template_name}</td>
                          <td>{fmt(row.pending_kg, 1)} KG</td>
                          <td>
                            {row.due_date ? String(row.due_date).slice(5) : "—"}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5} className={styles.emptyCell}>
                          No pending demand
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <div className={styles.sectionEyebrow}>
                    Recent planner activity
                  </div>
                  <h2 className={styles.panelTitle}>
                    Latest released and planned jobs
                  </h2>
                </div>
                <Activity className={styles.panelIcon} />
              </div>
              <div className={styles.scrollPanel}>
                {recentRows.length ? (
                  recentRows.map((row: any) => (
                    <div
                      key={`${row.job_number}-${row.work_center}`}
                      className={styles.activityRow}
                    >
                      <div>
                        <div className={styles.activityTitle}>
                          {row.job_number}
                        </div>
                        <div className={styles.activitySub}>
                          {row.product || "Custom"} ·{" "}
                          {row.work_center || "Unassigned"}
                        </div>
                      </div>
                      <span className={styles.activityBadge}>{row.state}</span>
                    </div>
                  ))
                ) : (
                  <div className={styles.emptyState}>No recent jobs</div>
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className={styles.sideColumn}>
          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.sectionEyebrow}>Immediate actions</div>
                <h2 className={styles.panelTitle}>
                  What needs planner attention now
                </h2>
              </div>
              <AlertTriangle className={styles.panelIcon} />
            </div>
            <div className={styles.scrollPanel}>
              {alerts.length ? (
                alerts.map((alert: any) => (
                  <Link
                    key={`${alert.type}-${alert.title}`}
                    href={
                      alert.href || "/dashboard/planner/control-tower/command"
                    }
                    className={styles.alertCard}
                  >
                    <div className={styles.alertCount}>{fmt(alert.count)}</div>
                    <div>
                      <div className={styles.alertTitle}>{alert.title}</div>
                      <div className={styles.alertDesc}>
                        {alert.description}
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <div className={styles.successCard}>
                  <CheckCircle2 size={16} />
                  All clear. No urgent planner blockers.
                </div>
              )}
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.sectionEyebrow}>Costing coverage</div>
                <h2 className={styles.panelTitle}>
                  How much of active demand is actual-costed
                </h2>
              </div>
              <TrendingUp className={styles.panelIcon} />
            </div>
            <div className={styles.coverageHero}>
              <div className={styles.coverageValue}>
                {fmt(costCoverage, 1)}%
              </div>
              <div className={styles.coverageSub}>
                Average actual cost coverage on active demand
              </div>
            </div>
            <div className={styles.costSplit}>
              <div className={styles.costChip}>
                <span>Actual</span>
                <strong>{fmt(actualCount)}</strong>
              </div>
              <div className={styles.costChip}>
                <span>Hybrid</span>
                <strong>{fmt(hybridCount)}</strong>
              </div>
              <div className={styles.costChip}>
                <span>Estimated</span>
                <strong>{fmt(estimatedCount)}</strong>
              </div>
            </div>
          </div>

          <div className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.sectionEyebrow}>Quick actions</div>
                <h2 className={styles.panelTitle}>
                  Open the live planner surfaces
                </h2>
              </div>
              <Package className={styles.panelIcon} />
            </div>
            <div className={styles.actionList}>
              <Link
                href="/dashboard/planner/control-tower/command"
                className={styles.actionCard}
              >
                <span>Planner control tower</span>
                <span>Open</span>
              </Link>
              <Link
                href="/production/planner/stock-launcher"
                className={styles.actionCard}
              >
                <span>Stock launcher</span>
                <span>Launch</span>
              </Link>
              <Link href="/master/products" className={styles.actionCard}>
                <span>Product Master</span>
                <span>Configure</span>
              </Link>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

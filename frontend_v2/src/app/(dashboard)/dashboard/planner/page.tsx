"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { analyticsApi } from "@/services/analytics";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ClipboardList,
  Factory, Layers, ListChecks, Loader2, Package, Plus,
  RefreshCw, Zap, Activity, Clock, Eye,
  Gauge, BarChart3, CalendarClock, AlertCircle,
} from "lucide-react";
import styles from "./planner.module.css";

/* ─────────────── Helpers ─────────────── */
function fmt(v: unknown, decimals = 1): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "number" ? v : parseFloat(String(v));
  if (isNaN(n)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

/* ─────────────── Animated Counter ─────────────── */
function AnimCount({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const start = display; const end = value; const dur = 800;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      setDisplay(start + (end - start) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{display.toLocaleString("en-IN", { maximumFractionDigits: decimals })}</>;
}

/* ─────────────── KPI Card ─────────────── */
function KPICard({ label, value, sub, icon, gradientClass, suffix = "", delay = "0ms" }: {
  label: string; value: number;
  icon: React.ReactNode; gradientClass: string;
  sub?: string; suffix?: string; delay?: string;
}) {
  return (
    <div className={styles.kpiCard} style={{ animationDelay: delay }}>
      <div className={`${styles.kpiIconWrap} ${gradientClass}`}>{icon}</div>
      <div className={styles.kpiContent}>
        <div className={styles.kpiLabel}>{label}</div>
        <div className={styles.kpiValue}>
          <AnimCount value={value} decimals={suffix === " KG" ? 1 : 0} />{suffix}
        </div>
        {sub && <div className={styles.kpiSub}>{sub}</div>}
      </div>
    </div>
  );
}

/* ─────────────── Chart Tooltip ─────────────── */
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.chartTooltip}>
      <div className={styles.chartTooltipLabel}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className={styles.chartTooltipItem} style={{ color: p.color }}>
          <span>{p.name}:</span> <strong>{fmt(p.value, 2)}</strong>
        </div>
      ))}
    </div>
  );
};

/* ─────────────── Colors ─────────────── */
const JOB_COLORS: Record<string, string> = {
  RUNNING: "#0ea5e9", COMPLETED: "#10b981", PAUSED: "#06b6d4",
  PENDING: "#78716c", CANCELLED: "#f43f5e", DRAFT: "#f59e0b",
  RELEASED: "#8b5cf6", EXECUTING: "#38bdf8", PLANNED: "#14b8a6",
  ON_HOLD: "#f59e0b",
};

/* ─────────────── MAIN PAGE ─────────────── */
export default function PlannerDashboardPage() {
  const [countdown, setCountdown] = useState(30);

  const query = useQuery({
    queryKey: ["planner-dashboard"],
    queryFn: () => analyticsApi.getPlannerDashboard(),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  useEffect(() => {
    setCountdown(30);
    const iv = setInterval(() => setCountdown(c => (c <= 1 ? 30 : c - 1)), 1000);
    return () => clearInterval(iv);
  }, [query.dataUpdatedAt]);

  const data = query.data ?? ({} as any);
  const qKPI: any = data.queue_kpis ?? {};
  const strip: any = data.status_strip ?? {};
  const jobDist: any[] = data.job_distribution ?? [];
  const wcCapacity: any[] = data.wc_capacity ?? [];
  const prodTrend: any[] = data.production_trend ?? [];
  const demandPipe: any[] = data.demand_pipeline ?? [];
  const alerts: any[] = data.alerts ?? [];
  const recent: any[] = data.recent_activity ?? [];

  const chartData = useMemo(() =>
    prodTrend.map((r: any) => ({
      date: String(r.date ?? "").slice(5),
      output_kg: Number(r.output_kg || 0),
    })), [prodTrend]);

  const jobTotal = jobDist.reduce((acc: number, d: any) => acc + (d.count ?? 0), 0);
  const isLoading = query.isLoading || query.isFetching;

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className={styles.plannerDash}>

      {/* ─── HERO HEADER ─── */}
      <div className={styles.heroCard}>
        {isLoading && (
          <div className={styles.loadingOverlay}>
            <RefreshCw size={22} className={styles.spin} style={{ color: "#bae6fd" }} />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 14, width: "100%" }}>
          <div>
            <h1 className={styles.heroTitle}>📋 Planner Command Center</h1>
            <p className={styles.heroSubtitle}>
              Queue · Capacity · Pipeline · Jobs — your planning intelligence at a glance
            </p>
          </div>
          <div className={styles.heroControls}>
            <div className={styles.countdownBadge}>
              <span className={styles.liveDot} />
              LIVE · {countdown}s
            </div>
            <button className={styles.refreshBtn} onClick={() => query.refetch()} disabled={isLoading}>
              <RefreshCw size={12} className={isLoading ? styles.spin : ""} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* ─── ROW 1: 6 PRIMARY KPI CARDS ─── */}
      <div className={styles.kpiGrid} style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <KPICard label="Planning Queue" value={qKPI.planning_queue || 0}
          icon={<ClipboardList size={17} color="#fff" />} gradientClass={styles.gSky}
          sub="Orders awaiting planning" delay="0ms" />
        <KPICard label="Ready / Released" value={qKPI.ready_released || 0}
          icon={<CheckCircle2 size={17} color="#fff" />} gradientClass={styles.gEmerald}
          sub="Jobs ready for production" delay="60ms" />
        <KPICard label="Blocked Orders" value={qKPI.blocked_count || 0}
          icon={<AlertTriangle size={17} color="#fff" />} gradientClass={styles.gAmber}
          sub="Need attention" delay="120ms" />
        <KPICard label="Required Qty" value={qKPI.required_kg || 0}
          icon={<Package size={17} color="#fff" />} gradientClass={styles.gCyan}
          suffix=" KG" sub="Queue demand" delay="180ms" />
        <KPICard label="Allocatable Stock" value={qKPI.allocatable_kg || 0}
          icon={<Layers size={17} color="#fff" />} gradientClass={styles.gViolet}
          suffix=" KG" sub="Available inventory" delay="240ms" />
        <KPICard label="Coverage" value={qKPI.coverage_pct || 0}
          icon={<Gauge size={17} color="#fff" />} gradientClass={styles.gTeal}
          suffix="%" sub="Stock vs demand" delay="300ms" />
      </div>

      {/* ─── ROW 2: STATUS STRIP ─── */}
      <div className={`${styles.quadGrid} ${styles.animUp}`} style={{ animationDelay: "100ms" }}>
        <div className={`${styles.statusCard} ${styles.statusRose}`}>
          <div className={styles.statusLabel}>Overdue Orders</div>
          <div className={styles.statusVal}>{strip.overdue_count || 0}</div>
          <div className={styles.statusSub}>past delivery date</div>
        </div>
        <div className={`${styles.statusCard} ${styles.statusAmber}`}>
          <div className={styles.statusLabel}>Due Today</div>
          <div className={styles.statusVal}>{strip.due_today_count || 0}</div>
          <div className={styles.statusSub}>need priority</div>
        </div>
        <div className={`${styles.statusCard} ${styles.statusSky}`}>
          <div className={styles.statusLabel}>Jobs Executing</div>
          <div className={styles.statusVal}>{strip.executing_jobs || 0}</div>
          <div className={styles.statusSub}>on shop floor</div>
        </div>
        <div className={`${styles.statusCard} ${styles.statusTeal}`}>
          <div className={styles.statusLabel}>Free Machines</div>
          <div className={styles.statusVal}>{strip.free_machine_slots || 0}</div>
          <div className={styles.statusSub}>of {strip.total_machines || 0} total</div>
        </div>
      </div>

      {/* ─── ROW 3: PRODUCTION TREND + ALERTS ─── */}
      <div className={`${styles.chartsGrid} ${styles.animUp}`} style={{ animationDelay: "150ms" }}>
        {/* Production Output Trend */}
        <div className={styles.glassCard}>
          <div className={styles.sectionTitle}><Activity size={13} /> Production Output — 30 Day Trend</div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 8, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="planProdG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(14,165,233,0.08)" />
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="output_kg" name="Output KG" stroke="#0ea5e9" strokeWidth={2} fill="url(#planProdG)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Alerts & Immediate Actions */}
        <div className={styles.glassCard}>
          <div className={styles.sectionTitle}><AlertCircle size={13} /> Immediate Actions</div>
          {alerts.length === 0 ? (
            <div className={styles.allClear}><CheckCircle2 size={16} /> <span>All clear — no urgent items</span></div>
          ) : alerts.map((a: any, i: number) => (
            <Link key={i} href={a.href || "/production/planner"} style={{ textDecoration: "none" }}>
              <div className={`${styles.alertRow} ${a.severity === "HIGH" ? styles.alertHigh : a.severity === "MEDIUM" ? styles.alertMedium : styles.alertLow}`}>
                <div className={styles.alertCount}>{a.count}</div>
                <div>
                  <div className={styles.alertTitle}>{a.title}</div>
                  <div className={styles.alertDesc}>{a.description}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ─── ROW 4: JOB DISTRIBUTION + WORK CENTER CAPACITY ─── */}
      <div className={`${styles.dualGrid} ${styles.animUp}`} style={{ animationDelay: "180ms" }}>
        {/* Job Distribution */}
        <div className={styles.glassCard}>
          <div className={styles.sectionTitle}><BarChart3 size={13} /> Job Distribution</div>
          {jobDist.length > 0 ? (
            <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
              <div style={{ width: 160, height: 160, position: "relative" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={jobDist} dataKey="count" nameKey="job_state" cx="50%" cy="50%" innerRadius={48} outerRadius={68} paddingAngle={3}>
                      {jobDist.map((e: any, i: number) => <Cell key={i} fill={JOB_COLORS[e.job_state] ?? "#64748b"} />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 900, color: "#0284c7" }}>{jobTotal}</div>
                    <div style={{ fontSize: 8, color: "#64748b", fontWeight: 700 }}>JOBS</div>
                  </div>
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                {jobDist.map((d: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 3, background: JOB_COLORS[d.job_state] ?? "#64748b" }} />
                      <span style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>{d.job_state}</span>
                    </div>
                    <span style={{ fontSize: 12, color: "#0f172a", fontWeight: 800 }}>{d.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <div className={styles.emptyState}>No jobs</div>}
        </div>

        {/* Work Center Capacity */}
        <div className={styles.glassCard}>
          <div className={styles.sectionTitle}><Factory size={13} /> Work Center Capacity</div>
          {wcCapacity.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {wcCapacity.map((wc: any, i: number) => (
                <div key={i} className={styles.wcRow}>
                  <div className={styles.wcName}>{wc.wc_name}</div>
                  <div className={styles.wcBarTrack}>
                    <div className={`${styles.wcBarFill} ${wc.utilization >= 80 ? styles.fillEmerald : wc.utilization >= 40 ? styles.fillSky : styles.fillAmber}`}
                      style={{ width: `${Math.min(100, wc.utilization)}%` }} />
                  </div>
                  <div className={styles.wcStats}>
                    <span className={styles.wcStatItem}>
                      <span className={styles.wcStatHighlight}>{wc.utilization}%</span>
                    </span>
                    <span className={styles.wcStatItem}>
                      {wc.running}/{wc.machine_count}
                    </span>
                    {wc.pending_jobs > 0 && (
                      <span className={styles.wcStatItem} style={{ color: "#f59e0b" }}>
                        +{wc.pending_jobs} pending
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : <div className={styles.emptyState}>No work centers</div>}
        </div>
      </div>

      {/* ─── ROW 5: DEMAND PIPELINE + RECENT ACTIVITY ─── */}
      <div className={`${styles.dualGrid} ${styles.animUp}`} style={{ animationDelay: "200ms" }}>
        {/* Sales Demand Pipeline */}
        <div className={styles.glassCard}>
          <div className={styles.sectionTitle}><CalendarClock size={13} /> Sales Demand Pipeline</div>
          {demandPipe.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table className={styles.demandTable}>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Product</th>
                    <th style={{ textAlign: "right" }}>Pending KG</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {demandPipe.slice(0, 8).map((d: any, i: number) => {
                    const isOverdue = d.due_date && d.due_date < today;
                    return (
                      <tr key={i}>
                        <td style={{ color: "#0284c7", fontWeight: 800 }}>{d.so_number}</td>
                        <td style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.customer}</td>
                        <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.template_name}</td>
                        <td style={{ textAlign: "right", fontWeight: 800 }}>{fmt(d.pending_kg)}</td>
                        <td>
                          {d.due_date ? (
                            isOverdue ? (
                              <span className={styles.overdueBadge}>
                                <AlertTriangle size={10} />{d.due_date.slice(5)}
                              </span>
                            ) : (
                              <span style={{ fontSize: 11, color: "#475569" }}>{d.due_date.slice(5)}</span>
                            )
                          ) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className={styles.emptyState}>No pending demand</div>}
        </div>

        {/* Recent Activity */}
        <div className={styles.glassCard}>
          <div className={styles.sectionTitle}><Clock size={13} /> Recent Jobs</div>
          {recent.length > 0 ? recent.map((j: any, i: number) => (
            <div key={i} className={styles.activityRow}>
              <div className={styles.activityJob}>{String(j.job_number || "—").slice(-8)}</div>
              <div className={styles.activityProduct}>{j.product || "—"}</div>
              <div className={styles.activityWC}>{j.work_center || "—"}</div>
              <div className={`${styles.activityStateBadge} ${j.state === "RELEASED" ? styles.stateReleased : j.state === "PLANNED" ? styles.statePlanned : styles.stateExecuting}`}>
                {j.state}
              </div>
            </div>
          )) : (
            <div className={styles.emptyState} style={{ flexDirection: "column", gap: 6 }}>
              <Zap size={20} style={{ color: "#0284c7", opacity: 0.4 }} />
              <span>No recent activity</span>
            </div>
          )}
        </div>
      </div>

      {/* ─── ROW 6: QUICK ACTIONS ─── */}
      <div className={`${styles.glassCard} ${styles.animUp}`} style={{ animationDelay: "220ms" }}>
        <div className={styles.sectionTitle}><Zap size={13} /> Quick Actions</div>
        <div className={styles.actionGrid}>
          <Link href="/production/planner" className={styles.actionCard}>
            <div className={styles.actionIconWrap} style={{ background: "linear-gradient(135deg, #0ea5e9, #0284c7)" }}>
              <ListChecks size={20} color="#fff" />
            </div>
            <div className={styles.actionLabel}>Planner Workbench</div>
            <div className={styles.actionDesc}>Plan, source & release orders</div>
          </Link>
          <Link href="/production/planner/stock-orders/create" className={styles.actionCard}>
            <div className={styles.actionIconWrap} style={{ background: "linear-gradient(135deg, #10b981, #059669)" }}>
              <Plus size={20} color="#fff" />
            </div>
            <div className={styles.actionLabel}>Create Stock Order</div>
            <div className={styles.actionDesc}>New MTS production order</div>
          </Link>
          <Link href="/factory/overview" className={styles.actionCard}>
            <div className={styles.actionIconWrap} style={{ background: "linear-gradient(135deg, #8b5cf6, #7c3aed)" }}>
              <Eye size={20} color="#fff" />
            </div>
            <div className={styles.actionLabel}>Visual Factory</div>
            <div className={styles.actionDesc}>See live plant status</div>
          </Link>
          <Link href="/analytics/inventory-health" className={styles.actionCard}>
            <div className={styles.actionIconWrap} style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)" }}>
              <Package size={20} color="#fff" />
            </div>
            <div className={styles.actionLabel}>Inventory Health</div>
            <div className={styles.actionDesc}>Check stock availability</div>
          </Link>
        </div>
      </div>

      {/* ─── ERROR ─── */}
      {query.isError && (
        <div className={`${styles.errorBanner} ${styles.animIn}`}>
          <AlertTriangle size={15} /> <span>API failed — showing cached data. Click Refresh or ensure servers are running.</span>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    BarChart3,
    Calendar,
    CheckCircle2,
    Cpu,
    Inbox,
    PauseCircle,
    Plus,
    RefreshCw,
    Rocket,
    Sparkles,
    TrendingUp,
    Users,
    Workflow,
    Zap,
} from "lucide-react";
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { analyticsApi } from "@/services/analytics";
import { plannerService, type PlannerControlOrder } from "@/services/planner";
import { Card, Hero, Button, EmptyState, Chip } from "@/components/_planner-ui";
import { HealthBar, type HealthSegment } from "../HealthBar";
import { OrderPassportStrip } from "../order-passport";
import { formatDisplayDate } from "@/lib/date-format";

function fmt(value: unknown, decimals = 0): string {
    if (value === null || value === undefined) return "—";
    const v = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function pct(value: unknown): string {
    const v = Number(value);
    if (!Number.isFinite(v)) return "—";
    return `${v.toFixed(0)}%`;
}

function dueBucket(dateStr: string | null | undefined): { label: string; tone: "danger" | "warn" | "info" | "muted"; days: number } {
    if (!dateStr) return { label: "no due", tone: "muted", days: NaN };
    const due = new Date(dateStr).getTime();
    if (Number.isNaN(due)) return { label: "no due", tone: "muted", days: NaN };
    const days = Math.floor((due - Date.now()) / (1000 * 60 * 60 * 24));
    if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: "danger", days };
    if (days === 0) return { label: "due today", tone: "danger", days };
    if (days <= 2) return { label: `due in ${days}d`, tone: "warn", days };
    if (days <= 7) return { label: `due in ${days}d`, tone: "info", days };
    return { label: `due in ${days}d`, tone: "muted", days };
}

function riskScore(o: PlannerControlOrder): number {
    let score = 0;
    const delivery = (o as any).delivery_date as string | null | undefined;
    if (delivery) {
        const due = new Date(delivery).getTime();
        if (!Number.isNaN(due)) {
            const days = (due - Date.now()) / (1000 * 60 * 60 * 24);
            if (days < 0) score += 50 + Math.min(50, Math.abs(days) * 4);
            else if (days <= 2) score += 30;
            else if (days <= 7) score += 12;
        }
    }
    const blockerCount = ((o as any).blockers as any[] | undefined)?.length || 0;
    score += blockerCount * 8;
    if (o.math_valid === false) score += 25;
    if (o.artwork_assignment_required && !o.assigned_artwork_id) score += 15;
    return score;
}

function deriveSegments(o: PlannerControlOrder): HealthSegment[] {
    const mathState: HealthSegment["state"] = o.math_valid === false ? "blocked" : "ok";
    const artworkRequired = !!o.artwork_assignment_required;
    const artworkAssigned = !!o.assigned_artwork_id;
    const artworkState: HealthSegment["state"] = !artworkRequired ? "skip" : artworkAssigned ? "ok" : "warn";
    const lineCount = o.material_plan_summary?.line_count ?? 0;
    const blockerCount = ((o as any).blockers as any[] | undefined)?.length || 0;
    const materialState: HealthSegment["state"] = lineCount === 0 ? "skip" : blockerCount > 0 ? "blocked" : "ok";
    const routeState: HealthSegment["state"] = Number.isFinite(o.required_start_step) && Number.isFinite(o.route_last_step_index) ? "ok" : "warn";
    return [
        { key: "math", state: mathState, label: "Math" },
        { key: "artwork", state: artworkState, label: "Artwork" },
        { key: "material", state: materialState, label: "Material" },
        { key: "route", state: routeState, label: "Route" },
    ];
}

const STATE_TONES: Record<string, { fg: string; bg: string }> = {
    EXECUTING: { fg: "var(--br-700)", bg: "rgba(37,99,235,.14)" },
    RUNNING: { fg: "var(--br-700)", bg: "rgba(37,99,235,.14)" },
    RELEASED: { fg: "var(--i-700)", bg: "rgba(99,102,241,.14)" },
    WAITING: { fg: "var(--a-700)", bg: "rgba(245,158,11,.14)" },
    PAUSED: { fg: "var(--r-700)", bg: "rgba(244,63,94,.14)" },
    PLANNED: { fg: "var(--text-3)", bg: "var(--surface-2)" },
    COMPLETED: { fg: "var(--e-700)", bg: "rgba(16,185,129,.14)" },
};

export default function CommandTab() {
    const dashboardQ = useQuery({
        queryKey: ["planner-dashboard-ct-v2"],
        queryFn: () => analyticsApi.getPlannerDashboard(),
        refetchInterval: 30_000,
        staleTime: 20_000,
        meta: { suppressGlobalError: true },
    });
    const hubQ = useQuery({
        queryKey: ["planner-control-hub-ct-v3"],
        queryFn: () => plannerService.getControlHub({ summary: true, planning_limit: 18, active_limit: 24, history_limit: 16, timeout_ms: 12000 }),
        refetchInterval: 60_000,
        staleTime: 30_000,
        meta: { suppressGlobalError: true },
    });

    const dashboard: any = dashboardQ.data ?? {};
    const queueKpis = dashboard.queue_kpis ?? {};
    const statusStrip = dashboard.status_strip ?? {};
    const sourceMix = dashboard.source_mix ?? {};
    const replenishmentMix = dashboard.replenishment_mix ?? {};
    const alerts: any[] = Array.isArray(dashboard.alerts) ? dashboard.alerts : [];
    const recentActivity: any[] = Array.isArray(dashboard.recent_activity) ? dashboard.recent_activity : [];
    const wcCapacity: any[] = Array.isArray(dashboard.wc_capacity) ? dashboard.wc_capacity : [];
    const productionTrend: any[] = Array.isArray(dashboard.production_trend) ? dashboard.production_trend : [];
    const demandPipeline: any[] = Array.isArray(dashboard.demand_pipeline) ? dashboard.demand_pipeline : [];
    const jobDistribution: any[] = Array.isArray(dashboard.job_distribution) ? dashboard.job_distribution : [];

    const orders = hubQ.data?.orders ?? [];
    const activeOrders = hubQ.data?.active_orders ?? [];

    const kpis = useMemo(() => {
        const planning = Number(queueKpis.planning_queue ?? 0);
        const ready = Number(queueKpis.ready_released ?? 0);
        const blocked = Number(queueKpis.blocked_count ?? 0);
        const overdue = Number(statusStrip.overdue_count ?? 0);
        const dueToday = Number(statusStrip.due_today_count ?? 0);
        const required = Number(queueKpis.required_kg ?? 0);
        const allocatable = Number(queueKpis.allocatable_kg ?? 0);
        const coverage = Number(queueKpis.coverage_pct ?? 0);
        const totalRunning = Number(statusStrip.total_running ?? 0);
        const handoff = activeOrders.length;

        return [
            { eyebrow: "Planning queue", value: fmt(planning), sub: "rows awaiting plan", accent: planning > 50 ? "warn" : "default" },
            { eyebrow: "Ready", value: fmt(ready), sub: "release-eligible", accent: "success" },
            { eyebrow: "Blocked", value: fmt(blocked), sub: "with blockers", accent: blocked > 0 ? "danger" : "default" },
            { eyebrow: "Overdue", value: fmt(overdue), sub: "past due date", accent: overdue > 0 ? "danger" : "default" },
            { eyebrow: "Due today", value: fmt(dueToday), sub: "delivery today", accent: dueToday > 0 ? "warn" : "default" },
            { eyebrow: "Required KG", value: fmt(required, 0), sub: "queue weight", accent: "info" },
            { eyebrow: "Coverage", value: pct(coverage), sub: `${fmt(allocatable, 0)} KG allocatable`, accent: coverage >= 80 ? "success" : coverage >= 40 ? "warn" : "danger" },
            { eyebrow: "WCM handoff", value: fmt(handoff || totalRunning), sub: "released / live lines", accent: "info" },
        ] as const;
    }, [activeOrders.length, queueKpis, statusStrip]);

    const isFetching = dashboardQ.isFetching || hubQ.isFetching;

    function refreshAll() {
        dashboardQ.refetch();
        hubQ.refetch();
    }

    const today = formatDisplayDate(new Date());

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Hero
                eyebrow="Planner Command Tower · Tab 1"
                title="Command — what to act on right now"
                subtitle={`${today} · live planner state across queue, source pools, WCM handoff, blockers, and demand pipeline`}
                actions={
                    <Button onClick={refreshAll} variant="ghost">
                        <RefreshCw size={14} className={isFetching ? "spin" : ""} style={{ marginRight: 6 }} />
                        Refresh
                    </Button>
                }
                kpis={kpis as any}
            />

            {/* Row 1: Priority Runway + Source Mix */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: 18 }}>
                <PriorityRunwayCard orders={orders} />
                <SourceMixCard sourceMix={sourceMix} replenishmentMix={replenishmentMix} queueKpis={queueKpis} alerts={alerts} />
            </div>

            {/* Row 2: Demand Pipeline + Job Distribution */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: 18 }}>
                <DemandPipelineCard demand={demandPipeline} />
                <JobDistributionCard distribution={jobDistribution} statusStrip={statusStrip} />
            </div>

            {/* Row 3: Work Center Load + Action Desk */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: 18 }}>
                <WorkCenterLoadCard wcCapacity={wcCapacity} />
                <ActionDeskCard alerts={alerts} statusStrip={statusStrip} queueKpis={queueKpis} activeCount={activeOrders.length} />
            </div>

            {/* Row 4: Production Output Trend (full width if data exists) + Recent Activity */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 18 }}>
                <OutputTrendCard trend={productionTrend} />
                <RecentActivityCard activity={recentActivity} />
            </div>
        </div>
    );
}

// ---------- Priority Runway ----------

function PriorityRunwayCard({ orders }: { orders: PlannerControlOrder[] }) {
    const sorted = [...orders].sort((a, b) => riskScore(b) - riskScore(a)).slice(0, 5);

    return (
        <Card className="is-emphasis">
            <SectionHeader
                eyebrow="Priority runway"
                title="Top 5 at-risk orders"
                icon={<AlertTriangle size={16} color="var(--danger)" />}
                action={<Link href="/dashboard/planner/control-tower/plan-queue" style={linkStyle}>Open Plan Queue →</Link>}
            />
            {sorted.length === 0 ? (
                <EmptyState title="Queue is clear" body="No open queue rows. Take a breath." />
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                    {sorted.map((o) => {
                        const segments = deriveSegments(o);
                        const due = dueBucket((o as any).delivery_date);
                        return (
                            <div
                                key={`${o.order_kind}-${o.order_id}`}
                                style={{
                                    padding: 14,
                                    background: "var(--surface-1)",
                                    border: "1px solid var(--border-soft)",
                                    borderRadius: "var(--r-3)",
                                    boxShadow: "var(--sh-flat)",
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <OrderPassportStrip order={o} compact showKpis={false} />
                                    </div>
                                    <div style={{ textAlign: "right" }}>
                                        <div style={{
                                            fontFamily: "var(--f-display)",
                                            fontSize: 18,
                                            fontWeight: 700,
                                            color: "var(--text-1)",
                                            lineHeight: 1,
                                        }}>
                                            {fmt(o.required_qty_kg, 0)}<span style={{ fontSize: 10, fontWeight: 600, color: "var(--text-3)", marginLeft: 2 }}>KG</span>
                                        </div>
                                        <div style={{
                                            marginTop: 4,
                                            fontSize: 10, fontWeight: 700,
                                            textTransform: "uppercase", letterSpacing: ".04em",
                                            color: due.tone === "danger" ? "var(--danger)" : due.tone === "warn" ? "var(--warning)" : due.tone === "info" ? "var(--info)" : "var(--text-4)",
                                        }}>
                                            {due.label}
                                        </div>
                                    </div>
                                </div>
                                <div style={{ marginTop: 12 }}>
                                    <HealthBar segments={segments} showLabels />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

// ---------- Source Mix ----------

function SourceMixCard({ sourceMix, replenishmentMix, queueKpis, alerts }: any) {
    const slices = [
        { name: "FG Batches", value: Number(sourceMix?.fg_batch_count || 0), unit: "batches", color: "#10b981" },
        { name: "Invariant", value: Number(sourceMix?.invariant_roll_kg || 0), unit: "KG", color: "#6366f1" },
        { name: "Upstream", value: Number(sourceMix?.upstream_roll_kg || 0), unit: "KG", color: "#0ea5e9" },
        { name: "POD Bulk", value: Number(replenishmentMix?.pod_bulk_open || 0), unit: "open", color: "#f59e0b" },
        { name: "Packaging", value: Number(replenishmentMix?.packaging_open || 0), unit: "open", color: "#7c3aed" },
    ];
    const total = slices.reduce((s, x) => s + x.value, 0);
    const required = Number(queueKpis?.required_kg || 0);
    const allocatable = Number(queueKpis?.allocatable_kg || 0);
    const coverage = Number(queueKpis?.coverage_pct || 0);
    const ready = Number(queueKpis?.ready_released || 0);
    const blocked = Number(queueKpis?.blocked_count || 0);
    const artworkPending = (alerts || []).filter((a: any) => String(a?.type || "").toUpperCase().includes("ARTWORK")).reduce((s: number, a: any) => s + Number(a?.count || 0), 0);
    const coverageTone = coverage >= 80 ? "var(--success)" : coverage >= 40 ? "var(--warning)" : "var(--danger)";

    return (
        <Card>
            <SectionHeader
                eyebrow="Source mix"
                title="Stock pool composition"
                icon={<Workflow size={16} color="var(--text-3)" />}
            />

            {total <= 0 ? (
                <div style={{ marginTop: 16 }}>
                    <EmptyState title="No source data" body="All pools are empty." />
                </div>
            ) : (
                <>
                    <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "150px 1fr", gap: 14, alignItems: "center" }}>
                        <div style={{ position: "relative", height: 150 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={slices}
                                        cx="50%" cy="50%"
                                        innerRadius={48} outerRadius={70}
                                        paddingAngle={2}
                                        stroke="var(--surface-1)" strokeWidth={2}
                                        dataKey="value" nameKey="name"
                                    >
                                        {slices.map((s, i) => <Cell key={i} fill={s.color} />)}
                                    </Pie>
                                    <Tooltip contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-3)", fontSize: 12 }}
                                        formatter={(v: any, n: any, item: any) => [`${fmt(Number(v), 1)} ${item.payload.unit}`, n]} />
                                </PieChart>
                            </ResponsiveContainer>
                            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                                <div style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 700, color: "var(--text-1)", lineHeight: 1 }}>
                                    {fmt(allocatable, 0)}
                                </div>
                                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-3)" }}>
                                    KG ready
                                </div>
                            </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {slices.map((s) => {
                                const p = total > 0 ? Math.round((s.value / total) * 100) : 0;
                                return (
                                    <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                                        <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                                        <span style={{ fontWeight: 600, color: "var(--text-2)" }}>{s.name}</span>
                                        <span style={{ marginLeft: "auto", fontFamily: "var(--f-mono)", color: "var(--text-2)" }}>{fmt(s.value, 1)}</span>
                                        <span style={{ width: 28, textAlign: "right", fontSize: 10, fontFamily: "var(--f-mono)", color: "var(--text-4)" }}>{p}%</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Coverage progress */}
                    <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-3)" }}>
                                Coverage
                            </span>
                            <span style={{ fontFamily: "var(--f-display)", fontSize: 20, fontWeight: 700, color: coverageTone }}>
                                {pct(coverage)}
                            </span>
                        </div>
                        <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${Math.min(100, coverage)}%`, background: coverageTone, transition: "width var(--ds) var(--eo)" }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--text-3)" }}>
                            <span>Allocatable <strong style={{ fontFamily: "var(--f-mono)", color: "var(--text-1)" }}>{fmt(allocatable, 0)}</strong> KG</span>
                            <span>Required <strong style={{ fontFamily: "var(--f-mono)", color: "var(--text-1)" }}>{fmt(required, 0)}</strong> KG</span>
                        </div>
                    </div>

                    {/* Readiness mini-tiles */}
                    <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                        <ReadinessTile label="Ready" value={ready} tone="success" />
                        <ReadinessTile label="Blocked" value={blocked} tone="danger" />
                        <ReadinessTile label="Artwork" value={artworkPending} tone="warn" />
                    </div>

                    {/* Quick actions */}
                    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-soft)", display: "flex", gap: 6 }}>
                        <Link href="/production/planner/stock-launcher" style={{ textDecoration: "none", flex: 1 }}>
                            <Button variant="primary" style={{ width: "100%" }}>
                                <Plus size={14} style={{ marginRight: 6 }} />
                                New stock order
                            </Button>
                        </Link>
                        <Link href="/dashboard/planner/control-tower/stock-intelligence" style={{ textDecoration: "none" }}>
                            <Button variant="secondary">Drill <ArrowRight size={14} style={{ marginLeft: 4 }} /></Button>
                        </Link>
                    </div>
                </>
            )}
        </Card>
    );
}

// ---------- Demand Pipeline ----------

function DemandPipelineCard({ demand }: { demand: any[] }) {
    const sorted = useMemo(() => {
        return [...demand]
            .sort((a, b) => Number(b.pending_kg || 0) - Number(a.pending_kg || 0))
            .slice(0, 8);
    }, [demand]);

    const totalPendingKg = useMemo(() => demand.reduce((s, r) => s + Number(r.pending_kg || 0), 0), [demand]);
    const max = sorted[0]?.pending_kg || 1;

    return (
        <Card className="is-emphasis">
            <SectionHeader
                eyebrow="Demand pipeline"
                title="Top pending sales demand"
                icon={<TrendingUp size={16} color="var(--br-700)" />}
                rightBadge={<BigNumber value={fmt(totalPendingKg, 0)} suffix="KG total" />}
            />

            {sorted.length === 0 ? (
                <EmptyState title="No pending demand" body="All sales orders are fulfilled or awaiting confirmation." />
            ) : (
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                    {sorted.map((d, i) => {
                        const due = dueBucket(d.due_date);
                        const widthPct = Math.max(2, (Number(d.pending_kg || 0) / Number(max)) * 100);
                        return (
                            <div key={`${d.so_number}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ width: 80, textAlign: "right", fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, color: "var(--text-1)", flexShrink: 0 }}>
                                    {d.so_number}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {d.customer || "—"}
                                        </span>
                                        <span style={{
                                            fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, color: "var(--text-1)",
                                            whiteSpace: "nowrap",
                                        }}>
                                            {fmt(d.pending_kg, 0)} <span style={{ fontSize: 9, color: "var(--text-4)" }}>/ {fmt(d.ordered_kg, 0)} KG</span>
                                        </span>
                                    </div>
                                    <div style={{ position: "relative", height: 6, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}>
                                        <div style={{
                                            height: "100%", width: `${widthPct}%`,
                                            background: due.tone === "danger" ? "linear-gradient(90deg, var(--danger), #ec4899)"
                                                : due.tone === "warn" ? "linear-gradient(90deg, var(--warning), #fb923c)"
                                                : "linear-gradient(90deg, var(--br-400), var(--br-600))",
                                        }} />
                                    </div>
                                </div>
                                <div style={{
                                    width: 84, textAlign: "right",
                                    fontSize: 9, fontWeight: 700,
                                    textTransform: "uppercase", letterSpacing: ".04em",
                                    color: due.tone === "danger" ? "var(--danger)" : due.tone === "warn" ? "var(--warning)" : due.tone === "info" ? "var(--info)" : "var(--text-4)",
                                    flexShrink: 0,
                                }}>
                                    {due.label}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

// ---------- Job Distribution ----------

function JobDistributionCard({ distribution, statusStrip }: { distribution: any[]; statusStrip: any }) {
    const data = useMemo(() => {
        const order = ["EXECUTING", "RUNNING", "RELEASED", "WAITING", "PAUSED", "PLANNED", "COMPLETED"];
        const map: Record<string, number> = {};
        for (const r of distribution) {
            map[String(r.job_state).toUpperCase()] = Number(r.count || 0);
        }
        const merged = order.map((state) => ({ state, count: map[state] || 0, color: STATE_TONES[state]?.fg || "var(--text-3)" }));
        return merged.filter((m) => m.count > 0);
    }, [distribution]);

    const total = data.reduce((s, x) => s + x.count, 0);
    const totalJobs = Number(statusStrip?.total_jobs ?? total);

    return (
        <Card>
            <SectionHeader
                eyebrow="Jobs"
                title="State distribution"
                icon={<Cpu size={16} color="var(--text-3)" />}
                rightBadge={<BigNumber value={fmt(totalJobs)} suffix="jobs" />}
            />
            {data.length === 0 ? (
                <EmptyState title="No jobs" body="Production jobs will appear once orders are released." />
            ) : (
                <div style={{ marginTop: 14 }}>
                    <div style={{ height: 130 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                                <XAxis type="number" hide />
                                <YAxis dataKey="state" type="category" width={86} tick={{ fontSize: 10, fill: "var(--text-3)", fontWeight: 700 }} axisLine={false} tickLine={false} />
                                <Tooltip contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-3)", fontSize: 12 }} />
                                <Bar dataKey="count" radius={[3, 3, 3, 3]}>
                                    {data.map((d, i) => <Cell key={i} fill={d.color} />)}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                        {data.slice(0, 6).map((d) => (
                            <div
                                key={d.state}
                                style={{
                                    padding: "6px 8px",
                                    background: STATE_TONES[d.state]?.bg || "var(--surface-2)",
                                    borderRadius: "var(--r-2)",
                                }}
                            >
                                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: STATE_TONES[d.state]?.fg || "var(--text-3)" }}>
                                    {d.state}
                                </div>
                                <div style={{ fontFamily: "var(--f-mono)", fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginTop: 1 }}>
                                    {d.count}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </Card>
    );
}

// ---------- Work Center Load ----------

function WorkCenterLoadCard({ wcCapacity }: { wcCapacity: any[] }) {
    const sorted = useMemo(() => {
        return [...wcCapacity]
            .filter((w) => Number(w.pending_jobs || 0) > 0 || Number(w.running || 0) > 0 || Number(w.machine_count || 0) > 0)
            .sort((a, b) => {
                const aLoad = Number(a.pending_jobs || 0) + Number(a.running || 0);
                const bLoad = Number(b.pending_jobs || 0) + Number(b.running || 0);
                if (bLoad !== aLoad) return bLoad - aLoad;
                return Number(b.utilization || 0) - Number(a.utilization || 0);
            })
            .slice(0, 10);
    }, [wcCapacity]);

    const maxLoad = Math.max(...sorted.map((w) => Number(w.pending_jobs || 0) + Number(w.running || 0)), 1);

    return (
        <Card className="is-emphasis">
            <SectionHeader
                eyebrow="WCM load"
                title="Where released jobs are waiting"
                icon={<BarChart3 size={16} color="var(--text-3)" />}
                rightBadge={<BigNumber value={fmt(wcCapacity.length)} suffix="centers" />}
            />
            {sorted.length === 0 ? (
                <EmptyState title="No work center activity" body="All centers idle. Capacity headroom available." />
            ) : (
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                    {sorted.map((w) => {
                        const pending = Number(w.pending_jobs || 0);
                        const running = Number(w.running || 0);
                        const util = Number(w.utilization || 0);
                        const totalLoad = pending + running;
                        const widthPct = Math.max(2, (totalLoad / maxLoad) * 100);
                        const utilPct = util * 100;
                        return (
                            <div key={w.wc_id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {w.wc_name}
                                        </span>
                                        <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--text-3)", whiteSpace: "nowrap" }}>
                                            {pending} pending · {running} running
                                        </span>
                                    </div>
                                    <div style={{ position: "relative", height: 8, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}>
                                        <div style={{
                                            position: "absolute", left: 0, top: 0, bottom: 0,
                                            width: `${widthPct}%`,
                                            background: utilPct >= 80 ? "linear-gradient(90deg, var(--danger), #fb7185)"
                                                : utilPct >= 40 ? "linear-gradient(90deg, var(--warning), #fb923c)"
                                                : "linear-gradient(90deg, var(--br-400), var(--br-600))",
                                            transition: "width var(--ds) var(--eo)",
                                        }} />
                                    </div>
                                </div>
                                <div style={{
                                    width: 60, textAlign: "right",
                                    fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700,
                                    color: utilPct >= 80 ? "var(--danger)" : utilPct >= 40 ? "var(--warning)" : "var(--text-2)",
                                }}>
                                    {pct(utilPct)}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

// ---------- Action Desk (right rail) ----------

function ActionDeskCard({ alerts, statusStrip, queueKpis, activeCount }: any) {
    return (
        <Card style={{
            background: "linear-gradient(180deg, var(--surface-3) 0%, #0f1934 100%)",
            color: "var(--text-on-dark)",
            border: "1px solid rgba(255,255,255,.08)",
            boxShadow: "var(--sh-md)",
        }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "rgba(255,255,255,.55)" }}>
                        Action desk
                    </div>
                    <div style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 700, color: "#fff", marginTop: 2 }}>
                        What needs attention
                    </div>
                </div>
                <Zap size={18} color="rgba(255,255,255,.5)" />
            </div>

            {(alerts || []).length === 0 ? (
                <div style={{ padding: 16, fontSize: 11, color: "rgba(255,255,255,.5)", fontStyle: "italic", textAlign: "center" }}>
                    No alerts. The system is calm.
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(alerts || []).map((a: any, i: number) => {
                        const tone = String(a.severity || "").toUpperCase();
                        const isHigh = tone === "HIGH" || tone === "CRITICAL";
                        const isMid = tone === "MEDIUM";
                        const accent = isHigh ? "#fda4af" : isMid ? "#fcd34d" : "#86efac";
                        const accentBg = isHigh ? "rgba(244,63,94,.18)" : isMid ? "rgba(245,158,11,.18)" : "rgba(16,185,129,.18)";
                        return (
                            <Link
                                key={i}
                                href={a.href || "/dashboard/planner/control-tower/plan-queue"}
                                style={{ textDecoration: "none" }}
                            >
                                <div style={{
                                    padding: "12px 14px",
                                    background: accentBg,
                                    border: "1px solid rgba(255,255,255,.06)",
                                    borderRadius: "var(--r-3)",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                }}>
                                    <div style={{
                                        width: 38, height: 38,
                                        borderRadius: "var(--r-3)",
                                        background: "rgba(255,255,255,.10)",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        flexShrink: 0,
                                    }}>
                                        <span style={{
                                            fontFamily: "var(--f-display)",
                                            fontSize: 16, fontWeight: 700,
                                            color: accent,
                                            lineHeight: 1,
                                        }}>
                                            {fmt(a.count)}
                                        </span>
                                    </div>
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>
                                            {a.title}
                                        </div>
                                        <div style={{ fontSize: 10, color: "rgba(255,255,255,.65)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {a.description}
                                        </div>
                                    </div>
                                    <ArrowRight size={14} color="rgba(255,255,255,.5)" />
                                </div>
                            </Link>
                        );
                    })}
                </div>
            )}

            {/* Bottom mini-stats */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,.08)", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                <DeskMiniStat label="Total queued" value={fmt(queueKpis?.planning_queue || 0)} />
                <DeskMiniStat label="Total jobs" value={fmt(statusStrip?.total_jobs || 0)} />
                <DeskMiniStat label="Live handoff" value={fmt(activeCount || statusStrip?.total_running || 0)} />
                <DeskMiniStat label="Coverage" value={pct(queueKpis?.coverage_pct || 0)} />
            </div>
        </Card>
    );
}

function DeskMiniStat({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ background: "rgba(255,255,255,.05)", padding: "8px 10px", borderRadius: "var(--r-2)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "rgba(255,255,255,.55)" }}>
                {label}
            </div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 14, fontWeight: 700, color: "#fff", marginTop: 2 }}>
                {value}
            </div>
        </div>
    );
}

// ---------- Output Trend ----------

function OutputTrendCard({ trend }: { trend: any[] }) {
    const data = useMemo(() => trend.map((r) => ({
        date: String(r.date || "").slice(5),
        output_kg: Number(r.output_kg || 0),
    })), [trend]);
    const total = data.reduce((s, x) => s + x.output_kg, 0);
    const peak = data.reduce((m, x) => Math.max(m, x.output_kg), 0);
    const avg = data.length > 0 ? total / data.length : 0;

    return (
        <Card>
            <SectionHeader
                eyebrow="Output trend"
                title="Production rhythm"
                icon={<Activity size={16} color="var(--text-3)" />}
                rightBadge={<BigNumber value={fmt(total, 0)} suffix="KG total" />}
            />
            {data.length === 0 ? (
                <EmptyState title="No output history" body="Output populates as machine terminal logs job completions." />
            ) : (
                <>
                    <div style={{ height: 180, marginTop: 14 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="cmd-output-area" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#2563eb" stopOpacity={0.36} />
                                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-4)" }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 10, fill: "var(--text-4)" }} axisLine={false} tickLine={false} />
                                <Tooltip contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-3)", fontSize: 12 }} />
                                <Area type="monotone" dataKey="output_kg" stroke="#1d4ed8" fill="url(#cmd-output-area)" strokeWidth={2.5} dot={{ fill: "#1d4ed8", r: 4 }} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        <MiniStatTile label="Days tracked" value={fmt(data.length)} />
                        <MiniStatTile label="Peak day" value={`${fmt(peak, 0)} KG`} />
                        <MiniStatTile label="Avg/day" value={`${fmt(avg, 0)} KG`} />
                    </div>
                </>
            )}
        </Card>
    );
}

// ---------- Recent Activity ----------

function RecentActivityCard({ activity }: { activity: any[] }) {
    return (
        <Card>
            <SectionHeader
                eyebrow="Recent activity"
                title="Latest job movement"
                icon={<Inbox size={16} color="var(--text-3)" />}
                action={<Link href="/dashboard/planner/control-tower/live-production" style={linkStyle}>Live production →</Link>}
            />
            {activity.length === 0 ? (
                <EmptyState title="No recent activity" body="As jobs are planned/released/completed they'll show here." />
            ) : (
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto" }}>
                    {activity.slice(0, 10).map((a, i) => {
                        const tone = STATE_TONES[String(a.state || "").toUpperCase()] || STATE_TONES.PLANNED;
                        return (
                            <div
                                key={`${a.job_number}-${i}`}
                                style={{
                                    padding: "8px 10px",
                                    background: "var(--surface-2)",
                                    borderRadius: "var(--r-2)",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 10,
                                    fontSize: 11,
                                }}
                            >
                                <span style={{
                                    fontSize: 9, fontWeight: 700,
                                    padding: "2px 7px",
                                    borderRadius: "var(--r-pill)",
                                    background: tone.bg, color: tone.fg,
                                    flexShrink: 0,
                                }}>
                                    {a.state}
                                </span>
                                <span style={{ fontFamily: "var(--f-mono)", fontWeight: 700, color: "var(--text-1)", flexShrink: 0 }}>
                                    {a.job_number}
                                </span>
                                <span style={{ color: "var(--text-3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {a.product || "—"} · {a.work_center || "—"}
                                </span>
                                <span style={{ fontFamily: "var(--f-mono)", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                                    {fmt(a.quantity)} KG
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

// ---------- Helpers ----------

function SectionHeader({ eyebrow, title, icon, action, rightBadge }: { eyebrow: string; title: string; icon?: React.ReactNode; action?: React.ReactNode; rightBadge?: React.ReactNode }) {
    return (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {icon}
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-3)" }}>
                        {eyebrow}
                    </span>
                </div>
                <div style={{ fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 700, color: "var(--text-1)", marginTop: 4, lineHeight: 1.2 }}>
                    {title}
                </div>
            </div>
            {rightBadge}
            {action}
        </div>
    );
}

function BigNumber({ value, suffix }: { value: string; suffix?: string }) {
    return (
        <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 700, color: "var(--text-1)", lineHeight: 1 }}>
                {value}
            </div>
            {suffix && (
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-3)", marginTop: 2 }}>
                    {suffix}
                </div>
            )}
        </div>
    );
}

function ReadinessTile({ label, value, tone }: { label: string; value: number; tone: "success" | "warn" | "danger" }) {
    const colors = {
        success: { fg: "var(--success)", bg: "rgba(16,185,129,.10)", border: "rgba(16,185,129,.22)" },
        warn: { fg: "var(--warning)", bg: "rgba(245,158,11,.10)", border: "rgba(245,158,11,.22)" },
        danger: { fg: "var(--danger)", bg: "rgba(244,63,94,.10)", border: "rgba(244,63,94,.22)" },
    }[tone];
    return (
        <div style={{
            padding: "8px 10px",
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: "var(--r-3)",
            textAlign: "center",
        }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: colors.fg }}>
                {label}
            </div>
            <div style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                {fmt(value)}
            </div>
        </div>
    );
}

function MiniStatTile({ label, value }: { label: string; value: string }) {
    return (
        <div style={{ padding: "8px 10px", background: "var(--surface-2)", borderRadius: "var(--r-2)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-3)" }}>
                {label}
            </div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginTop: 1 }}>
                {value}
            </div>
        </div>
    );
}

const linkStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontWeight: 700,
    color: "var(--link)",
    textDecoration: "none",
    whiteSpace: "nowrap",
};

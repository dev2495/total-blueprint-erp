"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ChevronRight, Filter, GitBranch, GitMerge, RefreshCw, Search, Zap } from "lucide-react";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { plannerService } from "@/services/planner";
import { analyticsApi } from "@/services/analytics";
import { Card, Hero, Button, EmptyState, Chip } from "@/components/_planner-ui";

function fmt(n: any, decimals = 0) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function pluralize(n: number, single: string, plural?: string) {
    return n === 1 ? single : plural || single + "s";
}

function routeNodeId(job: any): string {
    return String(job?.route_node?.route_node_id || job?.route_node_id || "").trim();
}

function routeNodeLabel(job: any): string {
    return String(job?.route_node?.route_node_label || job?.route_node?.label || routeNodeId(job) || "").trim();
}

function routeBranch(job: any): string {
    return String(job?.route_node?.route_branch_key || job?.route_node?.branch_key || job?.route_branch_key || "MAIN").trim() || "MAIN";
}

function batchLabel(job: any): string {
    return String(job?.production_batch_number || job?.batch_number || "").trim();
}

function salesLineIdFromJob(job: any): string {
    return String(job?.sales_order_item_id || job?.sales_order_item || "").trim();
}

function salesLineIdFromOrder(order: any): string {
    return String(order?.sales_order_item_id || "").trim();
}

function lineGroupKeyFromOrder(order: any): string {
    const lineId = salesLineIdFromOrder(order);
    if (lineId) return `line:${lineId}`;
    return `${order?.order_kind || "order"}:${order?.order_id || order?.order_number || "unknown"}`;
}

function lineGroupKeyFromJob(job: any): string {
    const lineId = salesLineIdFromJob(job);
    if (lineId) return `line:${lineId}`;
    return `job:${job?.order_number || "no-order"}:${job?.production_batch_id || job?.job_number || "unknown"}`;
}

function lineTitle(order: any, jobs: any[]) {
    return (
        String(order?.line_label || "").trim()
        || String(jobs[0]?.sales_order_line_label || "").trim()
        || String(order?.display_name || "").trim()
        || String(jobs[0]?.product_name || jobs[0]?.template_name || "").trim()
        || "Production line"
    );
}

function pct(produced: number, target: number) {
    if (!Number.isFinite(target) || target <= 0) return 0;
    return Math.max(0, Math.min(100, (produced / target) * 100));
}

function sourcePath(job: any): "FG" | "WIP" | "FRESH" {
    const origin = String(job?.origin || job?.source_type || "").toUpperCase();
    if (origin.includes("FG") || origin === "FG_BATCH") return "FG";
    if (origin.includes("WIP") || origin.includes("STOCK") || origin.includes("ROLL") || origin.includes("MTS")) return "WIP";
    return "FRESH";
}

function stateToken(job: any) {
    const raw = String(job?.job_state || "").toUpperCase();
    return raw === "EXECUTING" ? "RUNNING" : raw;
}

function searchableJobText(job: any) {
    return [
        job?.job_number,
        job?.order_number,
        job?.customer_name,
        job?.product_name,
        job?.template_name,
        job?.work_center_name,
        job?.process_name,
        job?.process_code,
        batchLabel(job),
        routeNodeLabel(job),
        routeBranch(job),
    ].join(" ").toLowerCase();
}

const STATE_COLORS: Record<string, { bg: string; fg: string; border: string; pulse?: boolean; label: string }> = {
    EXECUTING: { bg: "rgba(37,99,235,.18)", fg: "var(--br-700)", border: "rgba(37,99,235,.45)", pulse: true, label: "RUNNING" },
    RUNNING: { bg: "rgba(37,99,235,.18)", fg: "var(--br-700)", border: "rgba(37,99,235,.45)", pulse: true, label: "RUNNING" },
    RELEASED: { bg: "rgba(99,102,241,.14)", fg: "var(--i-700)", border: "rgba(99,102,241,.32)", label: "RELEASED" },
    WAITING: { bg: "rgba(245,158,11,.16)", fg: "var(--a-700)", border: "rgba(245,158,11,.32)", label: "WAITING" },
    PAUSED: { bg: "rgba(244,63,94,.14)", fg: "var(--r-700)", border: "rgba(244,63,94,.32)", label: "PAUSED" },
    PLANNED: { bg: "var(--surface-2)", fg: "var(--text-3)", border: "var(--border-soft)", label: "PLANNED" },
    COMPLETED: { bg: "rgba(16,185,129,.12)", fg: "var(--e-700)", border: "rgba(16,185,129,.30)", label: "COMPLETED" },
};

const ROUTE_BOARD_LIMIT = 50;
const RAIL_COLUMN_LIMIT = 12;
const STATE_FILTERS = ["ALL", "RUNNING", "RELEASED", "WAITING", "PAUSED"] as const;
const SOURCE_FILTERS = [
    { id: "ALL", label: "All paths" },
    { id: "FG", label: "FG" },
    { id: "WIP", label: "WIP" },
    { id: "FRESH", label: "Fresh" },
] as const;

export default function LiveProductionTab() {
    const [routeSearch, setRouteSearch] = useState("");
    const [stateFilter, setStateFilter] = useState<(typeof STATE_FILTERS)[number]>("ALL");
    const [sourceFilter, setSourceFilter] = useState<(typeof SOURCE_FILTERS)[number]["id"]>("ALL");
    const jobsQ = useQuery({
        queryKey: ["planner-jobs-lp-v2"],
        queryFn: () => plannerService.getJobs({
            limit: 240,
            states: ["PLANNED", "RELEASED", "WAITING", "EXECUTING", "PAUSED", "COMPLETED"],
            timeout_ms: 20000,
        }),
        refetchInterval: 90_000,
        staleTime: 60_000,
        meta: { suppressGlobalError: true },
    });
    const summaryQ = useQuery({
        queryKey: ["planner-live-summary-lp-v1"],
        queryFn: () => plannerService.getLiveProductionSummary({ limit: 240, timeout_ms: 12000 }),
        refetchInterval: 60_000,
        staleTime: 30_000,
        meta: { suppressGlobalError: true },
    });
    const dashboardQ = useQuery({
        queryKey: ["planner-dashboard-lp-v2"],
        queryFn: () => analyticsApi.getPlannerDashboard(),
        refetchInterval: 120_000,
        staleTime: 90_000,
        meta: { suppressGlobalError: true },
    });
    const hubQ = useQuery({
        queryKey: ["planner-control-hub-lp-v3"],
        queryFn: () => plannerService.getControlHub({ summary: true, planning_limit: 0, active_limit: 80, history_limit: 0, timeout_ms: 12000 }),
        refetchInterval: 180_000,
        staleTime: 120_000,
        meta: { suppressGlobalError: true },
    });

    const jobs: any[] = jobsQ.data ?? [];
    const dashboard: any = dashboardQ.data ?? {};
    const trend = Array.isArray(dashboard.production_trend) ? dashboard.production_trend : [];
    const activeOrders = hubQ.data?.active_orders ?? [];
    const liveKpis = summaryQ.data?.kpis;
    const jobsForView = useMemo(() => {
        const q = routeSearch.trim().toLowerCase();
        return jobs.filter((job) => {
            const state = stateToken(job);
            if (stateFilter !== "ALL" && state !== stateFilter) return false;
            if (sourceFilter !== "ALL" && sourcePath(job) !== sourceFilter) return false;
            if (q && !searchableJobText(job).includes(q)) return false;
            return true;
        });
    }, [jobs, routeSearch, sourceFilter, stateFilter]);

    // ---- KPIs ----
    const kpis = useMemo(() => {
        const counts: Record<string, number> = {};
        let totalActiveKg = 0;
        let pausedCount = 0;
        for (const j of jobs) {
            const s = String(j?.job_state || "").toUpperCase();
            counts[s] = (counts[s] || 0) + 1;
            if (s === "EXECUTING" || s === "RUNNING" || s === "RELEASED" || s === "WAITING") {
                totalActiveKg += Number(j?.total_weight_kg || j?.quantity || 0);
            }
            if (s === "PAUSED" || j?.is_on_hold) pausedCount++;
        }
        const executing = Number(liveKpis?.executing_count ?? ((counts["EXECUTING"] || 0) + (counts["RUNNING"] || 0)));
        const released = Number(liveKpis?.released_count ?? (counts["RELEASED"] || 0));
        const waiting = Number(liveKpis?.waiting_count ?? (counts["WAITING"] || 0));
        pausedCount = Number(liveKpis?.paused_count ?? pausedCount);
        const completedToday = jobs.filter((j) => {
            if (String(j?.job_state || "").toUpperCase() !== "COMPLETED") return false;
            const closed = j?.closed_at ? new Date(j.closed_at).getTime() : null;
            if (!closed) return false;
            return Date.now() - closed < 24 * 60 * 60 * 1000;
        }).length;
        const variance = Number(liveKpis?.variance_count ?? jobs.filter((j) => j?.closed_with_variance).length);
        const totalInFlight = Number(liveKpis?.total_in_flight ?? (executing + released + waiting + pausedCount));
        return [
            { eyebrow: "Executing", value: fmt(executing), sub: "actively running", accent: executing > 0 ? ("info" as const) : ("default" as const) },
            { eyebrow: "Released", value: fmt(released), sub: "ready to start", accent: "default" as const },
            { eyebrow: "Waiting", value: fmt(waiting), sub: "queued at WC", accent: waiting > 0 ? ("warn" as const) : ("default" as const) },
            { eyebrow: "Paused", value: fmt(pausedCount), sub: "on hold", accent: pausedCount > 0 ? ("danger" as const) : ("default" as const) },
            { eyebrow: "Active KG", value: fmt(liveKpis?.active_kg ?? totalActiveKg, 0), sub: "in flight", accent: "info" as const },
            { eyebrow: "Closed 24h", value: fmt(liveKpis?.closed_24h ?? completedToday), sub: "completed today", accent: "success" as const },
            { eyebrow: "Variance", value: fmt(variance), sub: "with variance", accent: variance > 0 ? ("warn" as const) : ("default" as const) },
            { eyebrow: "Total in flight", value: fmt(totalInFlight), sub: "all states", accent: "default" as const },
        ];
    }, [jobs, liveKpis]);

    // ---- Released rail bucketed by source ----
    const releasedRail = useMemo(() => {
        const buckets: { fg: any[]; wip: any[]; fresh: any[] } = { fg: [], wip: [], fresh: [] };
        for (const j of jobsForView) {
            const s = String(j?.job_state || "").toUpperCase();
            if (!["RELEASED", "EXECUTING", "RUNNING", "WAITING"].includes(s)) continue;
            const path = sourcePath(j);
            if (path === "FG") buckets.fg.push(j);
            else if (path === "WIP") buckets.wip.push(j);
            else buckets.fresh.push(j);
        }
        return buckets;
    }, [jobsForView]);

    // ---- Group active jobs by commercial sales line, with that line's actual route ----
    // Uses template_steps from active_orders if available; otherwise derives from job route/process data.
    const orderGroups = useMemo(() => {
        const groups: Map<string, { order?: any; jobs: any[]; routeSteps: any[] }> = new Map();
        const ordersByLineId = new Map<string, any>();

        for (const o of activeOrders) {
            const key = lineGroupKeyFromOrder(o);
            const tmplSteps: any[] = Array.isArray((o as any).template_steps) ? (o as any).template_steps : [];
            groups.set(key, { order: o, jobs: [], routeSteps: tmplSteps });
            const lineId = salesLineIdFromOrder(o);
            if (lineId) ordersByLineId.set(lineId, o);
        }

        const activeJobs = jobsForView.filter((j) => {
            const s = String(j?.job_state || "").toUpperCase();
            return ["RELEASED", "EXECUTING", "RUNNING", "WAITING", "PAUSED"].includes(s);
        });
        for (const j of activeJobs) {
            const lineId = salesLineIdFromJob(j);
            const matchedOrder = lineId ? ordersByLineId.get(lineId) : undefined;
            const key = matchedOrder ? lineGroupKeyFromOrder(matchedOrder) : lineGroupKeyFromJob(j);
            if (!groups.has(key)) {
                groups.set(key, {
                    order: matchedOrder,
                    jobs: [],
                    routeSteps: matchedOrder && Array.isArray(matchedOrder.template_steps) ? matchedOrder.template_steps : [],
                });
            }
            const group = groups.get(key)!;
            if (!group.order && matchedOrder) group.order = matchedOrder;
            group.jobs.push(j);
        }

        // For each group, ensure routeSteps. If missing, build from the union of unique process_codes across this group's jobs.
        for (const group of groups.values()) {
            if (group.routeSteps.length === 0 && group.jobs.length > 0) {
                const uniqueByCode = new Map<string, any>();
                for (const j of group.jobs) {
                    const code = j?.process_code || j?.process_category;
                    if (!code) continue;
                    const nodeId = routeNodeId(j) || code;
                    if (!uniqueByCode.has(nodeId)) {
                        uniqueByCode.set(nodeId, {
                            route_node_id: routeNodeId(j),
                            route_branch_key: routeBranch(j),
                            sequence_number: j?.current_step_index ?? uniqueByCode.size,
                            process_code: code,
                            process_name: j?.route_node?.route_node_label || j?.process_name || code,
                            step_name: j?.route_node?.route_node_label || j?.process_name || code,
                        });
                    }
                }
                group.routeSteps = Array.from(uniqueByCode.values()).sort((a, b) => (a.sequence_number || 0) - (b.sequence_number || 0));
            }
        }

        const result = Array.from(groups.entries())
            .filter(([_, g]) => g.jobs.length > 0);
        return result;
    }, [activeOrders, jobsForView]);
    const routeBoardGroups = orderGroups.slice(0, ROUTE_BOARD_LIMIT);

    // Exceptions
    const exceptions = useMemo(() => {
        return jobsForView.filter((j) => {
            const s = String(j?.job_state || "").toUpperCase();
            return s === "PAUSED" || j?.is_on_hold || j?.closed_with_variance;
        }).slice(0, 8);
    }, [jobsForView]);

    // Trend data
    const trendData = useMemo(
        () => trend.map((row: any) => ({ date: String(row.date || "").slice(5), output_kg: Number(row.output_kg || 0) })),
        [trend]
    );

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Hero
                eyebrow="Planner Command Tower · Tab 3"
                title="Live Production"
                subtitle="What's running right now — released rail, active orders × their actual routes, exceptions, output rhythm."
                actions={
                    <Button variant="ghost" onClick={() => { jobsQ.refetch(); hubQ.refetch(); summaryQ.refetch(); }}>
                        <RefreshCw size={14} className={jobsQ.isFetching || hubQ.isFetching || summaryQ.isFetching ? "spin" : ""} style={{ marginRight: 6 }} />
                        Refresh
                    </Button>
                }
            />

            {/* Released rail — 3 source paths */}
            <Card>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                    <div>
                        <div className="t-eyebrow">Released orders rail</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                            Grouped by source path
                        </div>
                    </div>
                    <Zap size={16} color="var(--text-3)" />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                    <RailColumn title="FG match" tone="success" jobs={releasedRail.fg} />
                    <RailColumn title="WIP convertible" tone="info" jobs={releasedRail.wip} />
                    <RailColumn title="Fresh runs" tone="brand" jobs={releasedRail.fresh} />
                </div>
                {releasedRail.fg.length === 0 && releasedRail.wip.length === 0 && releasedRail.fresh.length === 0 && (
                    <div style={{ marginTop: 16 }}>
                        <EmptyState
                            title="No released or running jobs"
                            body="Release orders from the Plan Queue to see them flow here grouped by source path."
                        />
                    </div>
                )}
            </Card>

            {/* Active orders × their actual routes */}
            <Card>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
                    <div>
                        <div className="t-eyebrow">Route board</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                            Sales lines × live batch routes
                        </div>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--text-4)", textAlign: "right" }}>
                        Each row uses the line&apos;s route snapshot · showing {routeBoardGroups.length} of {orderGroups.length} active lines
                    </span>
                </div>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                        gap: 10,
                        alignItems: "center",
                        marginBottom: 14,
                    }}
                >
                    <label
                        style={{
                            minHeight: 38,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            border: "1px solid var(--border-soft)",
                            borderRadius: "var(--r-3)",
                            background: "var(--surface-1-soft)",
                            padding: "0 12px",
                        }}
                    >
                        <Search size={14} color="var(--text-4)" />
                        <input
                            value={routeSearch}
                            onChange={(event) => setRouteSearch(event.target.value)}
                            placeholder="Search order, batch, customer, route, work center..."
                            style={{
                                minWidth: 0,
                                flex: 1,
                                border: 0,
                                outline: "none",
                                background: "transparent",
                                fontSize: 12,
                                fontWeight: 700,
                                color: "var(--text-1)",
                            }}
                        />
                    </label>
                    <FilterGroup
                        icon={<Filter size={13} />}
                        value={stateFilter}
                        options={STATE_FILTERS.map((value) => ({ id: value, label: value === "ALL" ? "All states" : value }))}
                        onChange={(value) => setStateFilter(value as typeof stateFilter)}
                    />
                    <FilterGroup
                        value={sourceFilter}
                        options={SOURCE_FILTERS}
                        onChange={(value) => setSourceFilter(value as typeof sourceFilter)}
                    />
                </div>

                {routeBoardGroups.length === 0 ? (
                    <EmptyState
                        title="No active orders"
                        body="No active order groups match the current route-board filters."
                    />
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {routeBoardGroups.map(([key, group]) => (
                            <OrderRouteRow
                                key={key}
                                orderNumber={group.order?.order_number || group.jobs[0]?.order_number || key}
                                order={group.order}
                                jobs={group.jobs}
                                routeSteps={group.routeSteps}
                            />
                        ))}
                        {orderGroups.length > routeBoardGroups.length && (
                            <EmptyState
                                title={`${orderGroups.length - routeBoardGroups.length} more active order groups`}
                                body="Use the Plan Queue or work-center filter to drill into the remaining groups. Header KPIs remain DB-wide."
                            />
                        )}
                    </div>
                )}
            </Card>

            {/* Exceptions + Output trend */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 18 }}>
                <Card>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                        <div>
                            <div className="t-eyebrow">Exceptions</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                                Paused, on-hold, variance
                            </div>
                        </div>
                        <AlertTriangle size={16} color="var(--text-3)" />
                    </div>
                    {exceptions.length === 0 ? (
                        <EmptyState title="No exceptions" body="No paused jobs, no holds, no variance flags." />
                    ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {exceptions.map((j: any) => (
                                <div
                                    key={j.id || j.job_number}
                                    style={{
                                        padding: "10px 12px",
                                        borderRadius: "var(--r-3)",
                                        background: "rgba(244,63,94,.06)",
                                        border: "1px solid rgba(244,63,94,.16)",
                                    }}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>
                                                {j.job_number}
                                            </div>
                                            <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                                                {j.product_name || j.template_name} · {j.work_center_name || "—"}
                                            </div>
                                        </div>
                                        <Chip kind={j.is_on_hold ? "blocked" : "paused"}>
                                            {j.is_on_hold ? "ON HOLD" : j.closed_with_variance ? "VARIANCE" : "PAUSED"}
                                        </Chip>
                                    </div>
                                    {j.hold_reason && (
                                        <div style={{ marginTop: 6, fontSize: 11, color: "var(--danger)" }}>
                                            Reason: {j.hold_reason}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </Card>

                <Card>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
                        <div>
                            <div className="t-eyebrow">Output trend</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                                30-day production rhythm
                            </div>
                        </div>
                        <Activity size={16} color="var(--text-3)" />
                    </div>
                    {trendData.length === 0 ? (
                        <EmptyState title="No trend data" body="Output history populates as jobs close." />
                    ) : (
                        <div style={{ height: 240 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={trendData} margin={{ top: 12, right: 6, left: -18, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="lp-area" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.28} />
                                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                                    <Tooltip contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-3)", fontSize: 12 }} />
                                    <Area type="monotone" dataKey="output_kg" stroke="#1d4ed8" fill="url(#lp-area)" strokeWidth={2} dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </Card>
            </div>

            <Card>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                    <div>
                        <div className="t-eyebrow">Live totals</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-1)", marginTop: 2 }}>
                            Control totals after line-level route review
                        </div>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--text-4)", textAlign: "right" }}>
                        Counts refresh with planner jobs and production summary.
                    </span>
                </div>
                <KpiStrip kpis={kpis} />
            </Card>
        </div>
    );
}

function KpiStrip({ kpis }: { kpis: Array<{ eyebrow: string; value: string; sub: string; accent: "default" | "info" | "warn" | "danger" | "success" }> }) {
    const toneMap = {
        default: { bg: "var(--surface-1-soft)", border: "var(--border-soft)", fg: "var(--text-1)" },
        info: { bg: "rgba(37,99,235,.06)", border: "rgba(37,99,235,.16)", fg: "var(--br-700)" },
        warn: { bg: "rgba(245,158,11,.08)", border: "rgba(245,158,11,.20)", fg: "var(--a-700)" },
        danger: { bg: "rgba(244,63,94,.07)", border: "rgba(244,63,94,.18)", fg: "var(--r-700)" },
        success: { bg: "rgba(16,185,129,.07)", border: "rgba(16,185,129,.18)", fg: "var(--e-700)" },
    };
    return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            {kpis.map((kpi) => {
                const tone = toneMap[kpi.accent] || toneMap.default;
                return (
                    <div
                        key={kpi.eyebrow}
                        style={{
                            minHeight: 82,
                            borderRadius: "var(--r-3)",
                            border: `1px solid ${tone.border}`,
                            background: tone.bg,
                            padding: "12px 14px",
                        }}
                    >
                        <div style={{ fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-4)" }}>
                            {kpi.eyebrow}
                        </div>
                        <div style={{ marginTop: 6, fontFamily: "var(--f-mono)", fontSize: 22, lineHeight: 1, fontWeight: 900, color: tone.fg }}>
                            {kpi.value}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 11, fontWeight: 650, color: "var(--text-3)" }}>
                            {kpi.sub}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function FilterGroup({
    icon,
    value,
    options,
    onChange,
}: {
    icon?: ReactNode;
    value: string;
    options: ReadonlyArray<{ id: string; label: string }>;
    onChange: (value: string) => void;
}) {
    return (
        <div
            style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                minHeight: 38,
                maxWidth: "100%",
                overflowX: "auto",
                padding: 4,
                border: "1px solid var(--border-soft)",
                borderRadius: "var(--r-3)",
                background: "var(--surface-1-soft)",
                whiteSpace: "nowrap",
            }}
        >
            {icon ? <span style={{ display: "inline-flex", color: "var(--text-4)", padding: "0 4px" }}>{icon}</span> : null}
            {options.map((option) => {
                const active = option.id === value;
                return (
                    <button
                        key={option.id}
                        type="button"
                        onClick={() => onChange(option.id)}
                        style={{
                            minWidth: 32,
                            height: 28,
                            padding: "0 9px",
                            borderRadius: "var(--r-2)",
                            border: `1px solid ${active ? "rgba(37,99,235,.34)" : "transparent"}`,
                            background: active ? "rgba(37,99,235,.10)" : "transparent",
                            color: active ? "var(--br-700)" : "var(--text-3)",
                            cursor: "pointer",
                            fontSize: 10,
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: ".04em",
                        }}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

function RailColumn({ title, tone, jobs }: { title: string; tone: "success" | "info" | "brand"; jobs: any[] }) {
    const accent = {
        success: { bg: "rgba(16,185,129,.06)", fg: "var(--e-700)", border: "rgba(16,185,129,.18)" },
        info: { bg: "rgba(99,102,241,.06)", fg: "var(--i-700)", border: "rgba(99,102,241,.18)" },
        brand: { bg: "rgba(37,99,235,.05)", fg: "var(--br-700)", border: "rgba(37,99,235,.16)" },
    }[tone];
    return (
        <div style={{ background: accent.bg, border: `1px solid ${accent.border}`, borderRadius: "var(--r-3)", padding: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: accent.fg }}>
                    {title}
                </span>
                <span style={{
                    fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700,
                    padding: "2px 10px", borderRadius: "var(--r-pill)",
                    background: "rgba(255,255,255,.7)", color: accent.fg,
                }}>
                    {jobs.length}
                </span>
            </div>
            {jobs.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--text-4)", fontStyle: "italic", padding: "8px 0" }}>
                    No jobs in this path
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {jobs.slice(0, RAIL_COLUMN_LIMIT).map((j) => {
                        const target = Number(j.total_weight_kg || j.quantity || 0);
                        const produced = Number(j.produced_qty || 0);
                        const pct = target > 0 ? Math.min(100, (produced / target) * 100) : 0;
                        return (
                            <div
                                key={j.id || j.job_number}
                                style={{
                                    background: "var(--surface-1)",
                                    borderRadius: "var(--r-2)",
                                    padding: "10px 12px",
                                    fontSize: 11,
                                    border: "1px solid var(--border-soft)",
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 4 }}>
                                    <span style={{ fontFamily: "var(--f-mono)", fontWeight: 700, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {j.job_number}
                                    </span>
                                    <span style={{ fontFamily: "var(--f-mono)", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                                        {fmt(produced, 1)}/{fmt(target, 0)} {j.uom || "KG"}
                                    </span>
                                </div>
                                <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {batchLabel(j) ? `${batchLabel(j)} · ` : ""}{routeBranch(j)} · {j.product_name || j.template_name || "—"} · {j.work_center_name || "—"}
                                </div>
                                <div style={{ height: 4, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${pct}%`, background: accent.fg, transition: "width var(--ds) var(--eo)" }} />
                                </div>
                            </div>
                        );
                    })}
                    {jobs.length > RAIL_COLUMN_LIMIT && (
                        <div style={{ fontSize: 10, color: "var(--text-4)", fontFamily: "var(--f-mono)", textAlign: "center", marginTop: 4 }}>
                            +{jobs.length - RAIL_COLUMN_LIMIT} more
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function MiniFact({ label, value }: { label: string; value: string }) {
    return (
        <div
            style={{
                minHeight: 54,
                border: "1px solid var(--border-soft)",
                borderRadius: "var(--r-2)",
                background: "var(--surface-1)",
                padding: "8px 10px",
            }}
        >
            <div style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-4)" }}>
                {label}
            </div>
            <div style={{ marginTop: 5, fontFamily: "var(--f-mono)", fontSize: 13, fontWeight: 900, color: "var(--text-1)" }}>
                {value}
            </div>
        </div>
    );
}

function OrderRouteRow({
    orderNumber,
    order,
    jobs,
    routeSteps,
}: {
    orderNumber: string;
    order: any;
    jobs: any[];
    routeSteps: any[];
}) {
    // Determine each step's state by looking at jobs at that step
    const stepsWithState = useMemo(() => {
        return routeSteps.map((step) => {
            // Find jobs whose process matches this step (by code or name)
            const matching = jobs.filter((j) => {
                const stepNodeId = String(step.route_node_id || step.node_id || "").trim();
                const jobNodeId = routeNodeId(j);
                if (stepNodeId && jobNodeId) return stepNodeId === jobNodeId;
                const stepNorm = String(step.process_name || step.process_code || step.step_name || "").toLowerCase();
                const jobNorm = String(j?.process_name || j?.process_code || "").toLowerCase();
                if (!stepNorm || !jobNorm) return false;
                return stepNorm.includes(jobNorm) || jobNorm.includes(stepNorm) || stepNorm === jobNorm;
            });
            // Pick the most "active" job's state for this step
            let dominantState = "—";
            const stateOrder = ["EXECUTING", "RUNNING", "WAITING", "PAUSED", "RELEASED", "PLANNED", "COMPLETED"];
            for (const s of stateOrder) {
                if (matching.some((j) => String(j?.job_state || "").toUpperCase() === s)) {
                    dominantState = s;
                    break;
                }
            }
            return { step, dominantState, jobs: matching };
        });
    }, [routeSteps, jobs]);

    const fgType = order?.fg_type || order?.final_product_type || jobs[0]?.product_name || "—";
    const customerName = order?.customer_name || jobs[0]?.customer_name;
    const visibleLineTitle = lineTitle(order, jobs);
    const lineStatus = String(order?.line_status_display || order?.line_status || jobs[0]?.job_state || "").replaceAll("_", " ");
    const profileLabel = order?.order_fact_sheet?.profile_label || order?.display_geometry_label;
    const requiredKg = Number(order?.required_qty_kg || jobs.reduce((s, j) => s + Number(j?.total_weight_kg || j?.quantity || 0), 0));
    const producedKg = jobs.reduce((s, j) => s + Number(j?.produced_qty || 0), 0);
    const completionPct = pct(producedKg, requiredKg);
    const batches = Array.from(
        jobs.reduce((map: Map<string, any>, job: any) => {
            const label = batchLabel(job);
            if (!label) return map;
            const current = map.get(label) || { label, jobs: [], states: new Set<string>(), produced: 0, target: 0, branch: routeBranch(job), node: routeNodeLabel(job) };
            current.jobs.push(job);
            current.states.add(stateToken(job));
            current.produced += Number(job?.produced_qty || 0);
            current.target += Number(job?.total_weight_kg || job?.quantity || 0);
            if (!current.node) current.node = routeNodeLabel(job);
            map.set(label, current);
            return map;
        }, new Map<string, any>()).values()
    );
    const batchCount = batches.length;
    const stageGroups = useMemo(() => {
        const grouped = new Map<number, typeof stepsWithState>();
        for (const item of stepsWithState) {
            const index = Number(item.step.sequence_number ?? item.step.route_index ?? 0);
            if (!grouped.has(index)) grouped.set(index, []);
            grouped.get(index)!.push(item);
        }
        return Array.from(grouped.entries())
            .sort(([a], [b]) => a - b)
            .map(([index, items]) => ({
                index,
                items: items.sort((a, b) =>
                    String(a.step.route_branch_key || "MAIN").localeCompare(String(b.step.route_branch_key || "MAIN"))
                ),
            }));
    }, [stepsWithState]);

    return (
        <div
            style={{
                background: "var(--surface-1-soft)",
                border: "1px solid var(--border-soft)",
                borderRadius: "var(--r-3)",
                padding: 14,
            }}
        >
            {/* Sales-line header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: "var(--f-mono)", fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
                            {orderNumber}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 900, color: "var(--text-1)" }}>
                            {visibleLineTitle}
                        </span>
                        <Chip kind={String(fgType).toLowerCase().includes("roll") ? "fg-roll" : "fg-pouch"}>{fgType}</Chip>
                        {lineStatus && <Chip kind="brand">{lineStatus}</Chip>}
                        {profileLabel && <Chip kind="size">{profileLabel}</Chip>}
                        {customerName && <Chip kind="brand">{customerName}</Chip>}
                    </div>
                    {order?.template_name && (
                        <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {order.template_name}
                        </div>
                    )}
                </div>
                <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: "var(--f-mono)", fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
                        {fmt(producedKg, 1)} / {fmt(requiredKg, 0)} KG
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                        {jobs.length} {pluralize(jobs.length, "job")} active{batchCount ? ` · ${batchCount} ${pluralize(batchCount, "batch", "batches")}` : ""}
                    </div>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 1fr) minmax(220px, 2fr)", gap: 10, alignItems: "center", marginBottom: 12 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                    <MiniFact label="Target" value={`${fmt(requiredKg, 0)} KG`} />
                    <MiniFact label="Produced" value={`${fmt(producedKg, 1)} KG`} />
                    <MiniFact label="Open" value={`${fmt(Math.max(requiredKg - producedKg, 0), 1)} KG`} />
                </div>
                <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 800, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 5 }}>
                        <span>Line production progress</span>
                        <span>{fmt(completionPct, 0)}%</span>
                    </div>
                    <div style={{ height: 8, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${completionPct}%`, background: "linear-gradient(90deg, var(--br-600), var(--e-700))" }} />
                    </div>
                </div>
            </div>

            {batches.length > 0 && (
                <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
                    {batches.slice(0, 8).map((batch: any) => {
                        const tone = STATE_COLORS[Array.from(batch.states)[0] as string] || STATE_COLORS.RELEASED;
                        return (
                            <div
                                key={batch.label}
                                style={{
                                    minWidth: 190,
                                    border: `1px solid ${tone.border}`,
                                    background: tone.bg,
                                    borderRadius: "var(--r-2)",
                                    padding: "8px 10px",
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 900, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {batch.label}
                                    </span>
                                    <span style={{ fontSize: 9, fontWeight: 900, color: tone.fg, textTransform: "uppercase" }}>
                                        {Array.from(batch.states)[0] as string}
                                    </span>
                                </div>
                                <div style={{ marginTop: 4, fontSize: 10, fontWeight: 700, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {batch.branch} · {batch.node || "route pending"}
                                </div>
                                <div style={{ marginTop: 5, height: 4, background: "rgba(255,255,255,.65)", borderRadius: 999, overflow: "hidden" }}>
                                    <div style={{ width: `${pct(batch.produced, batch.target)}%`, height: "100%", background: tone.fg }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Route trail */}
            {stepsWithState.length === 0 ? (
                <div style={{ fontSize: 11, color: "var(--text-4)", fontStyle: "italic" }}>Route not resolved for this active order.</div>
            ) : (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "stretch", gap: 6 }}>
                    {stageGroups.map((stage, stageIndex) => {
                        const hasParallel = stage.items.length > 1;
                        return (
                            <span key={`stage-${stage.index}`} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                                <div
                                    style={{
                                        minWidth: hasParallel ? 210 : 132,
                                        maxWidth: hasParallel ? 300 : 190,
                                        padding: 8,
                                        background: hasParallel ? "rgba(99,102,241,.07)" : "var(--surface-2)",
                                        border: `1px solid ${hasParallel ? "rgba(99,102,241,.20)" : "var(--border-soft)"}`,
                                        borderRadius: "var(--r-3)",
                                    }}
                                >
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 6 }}>
                                        <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, fontWeight: 800, color: "var(--text-4)", textTransform: "uppercase", letterSpacing: ".05em" }}>
                                            Stage {stage.index + 1}
                                        </span>
                                        {hasParallel && (
                                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, fontWeight: 800, color: "var(--i-700)", textTransform: "uppercase" }}>
                                                <GitBranch size={11} /> + parallel
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: "grid", gap: 6 }}>
                                        {stage.items.map(({ step, dominantState, jobs: stepJobs }) => {
                                            const tone = STATE_COLORS[dominantState] || STATE_COLORS.PLANNED;
                                            const isActiveStep = ["EXECUTING", "RUNNING", "WAITING", "PAUSED", "RELEASED"].includes(dominantState);
                                            const stepKgTarget = stepJobs.reduce((s: number, j: any) => s + Number(j?.total_weight_kg || j?.quantity || 0), 0);
                                            const stepKgProduced = stepJobs.reduce((s: number, j: any) => s + Number(j?.produced_qty || 0), 0);
                                            const stepBatchCount = new Set(stepJobs.map(batchLabel).filter(Boolean)).size;
                                            return (
                                                <div
                                                    key={`${step.route_node_id || step.process_code}-${step.route_branch_key || "MAIN"}`}
                                                    title={
                                                        stepJobs.length > 0
                                                            ? `${step.process_name || step.process_code} · ${stepJobs.length} job${stepJobs.length === 1 ? "" : "s"} · ${dominantState}`
                                                            : `${step.process_name || step.process_code} · idle`
                                                    }
                                                    style={{
                                                        padding: "8px 10px",
                                                        background: isActiveStep ? tone.bg : "var(--surface-1)",
                                                        border: `1px solid ${isActiveStep ? tone.border : "var(--border-soft)"}`,
                                                        borderRadius: "var(--r-2)",
                                                        opacity: isActiveStep ? 1 : 0.72,
                                                        animation: tone.pulse ? "ds-pulse 1.6s var(--eo) infinite" : "none",
                                                    }}
                                                >
                                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginBottom: 4 }}>
                                                        <span style={{ fontSize: 9, fontFamily: "var(--f-mono)", color: tone.fg, fontWeight: 800 }}>
                                                            {step.route_branch_key || "MAIN"} · {tone.label}
                                                        </span>
                                                        {step.parallel_group && (
                                                            <span style={{ fontSize: 8, fontWeight: 800, color: "var(--i-700)", background: "rgba(99,102,241,.10)", borderRadius: "var(--r-pill)", padding: "1px 5px" }}>
                                                                {step.parallel_group}
                                                            </span>
                                                        )}
                                                        {(step.is_join || step.join_key) && (
                                                            <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 8, fontWeight: 800, color: "var(--e-700)", background: "rgba(16,185,129,.10)", borderRadius: "var(--r-pill)", padding: "1px 5px" }}>
                                                                <GitMerge size={9} /> {step.join_key || "JOIN"}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: 12, fontWeight: 800, color: isActiveStep ? "var(--text-1)" : "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                        {step.process_name || step.process_code || step.step_name || "Step"}
                                                    </div>
                                                    {isActiveStep && stepKgTarget > 0 && (
                                                        <div style={{ fontSize: 9, fontFamily: "var(--f-mono)", color: "var(--text-3)", marginTop: 3 }}>
                                                            {fmt(stepKgProduced, 1)}/{fmt(stepKgTarget, 0)} KG · {stepBatchCount || stepJobs.length} batch
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                {stageIndex < stageGroups.length - 1 && <ChevronRight size={14} color="var(--text-4)" />}
                            </span>
                        );
                    })}
                </div>
            )}

            {/* Job list under the route */}
            {jobs.length > 0 && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--border-soft)" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {jobs.slice(0, 4).map((j: any) => {
                            const tone = STATE_COLORS[String(j.job_state || "").toUpperCase()] || STATE_COLORS.PLANNED;
                            const target = Number(j.total_weight_kg || j.quantity || 0);
                            const produced = Number(j.produced_qty || 0);
                            const pct = target > 0 ? Math.min(100, (produced / target) * 100) : 0;
                            return (
                                <div
                                    key={j.id || j.job_number}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        padding: "6px 10px",
                                        background: "var(--surface-1)",
                                        borderRadius: "var(--r-2)",
                                        fontSize: 11,
                                    }}
                                >
                                    <span style={{ fontFamily: "var(--f-mono)", fontWeight: 700, color: "var(--text-1)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                                        {j.job_number}
                                    </span>
                                    <span style={{ color: "var(--text-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                                        {batchLabel(j) ? `${batchLabel(j)} · ` : ""}{routeBranch(j)} · {j.process_name || j.process_code} · {j.work_center_name || "—"}
                                    </span>
                                    <div style={{ width: 80, height: 4, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}>
                                        <div style={{ height: "100%", width: `${pct}%`, background: tone.fg }} />
                                    </div>
                                    <span style={{
                                        fontSize: 9, fontWeight: 700, padding: "1px 6px",
                                        borderRadius: "var(--r-pill)",
                                        background: tone.bg, color: tone.fg, whiteSpace: "nowrap",
                                    }}>
                                        {tone.label}
                                    </span>
                                </div>
                            );
                        })}
                        {jobs.length > 4 && (
                            <div style={{ fontSize: 10, color: "var(--text-4)", textAlign: "center", padding: 4 }}>
                                +{jobs.length - 4} more {pluralize(jobs.length - 4, "job")}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

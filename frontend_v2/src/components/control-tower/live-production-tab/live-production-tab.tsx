"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Filter, PauseCircle, RefreshCw, Search, X } from "lucide-react";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { plannerService, type PlannerControlOrder, type PlannerOrderKind } from "@/services/planner";
import { analyticsApi } from "@/services/analytics";
import { Card, Hero, Button, EmptyState, Chip } from "@/components/_planner-ui";
import { useToast } from "@/hooks/use-toast";
import { OrderPassportStrip, ProductionTracePanel } from "../order-passport";

function fmt(n: any, decimals = 0) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "-";
    return v.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function stateTone(stateRaw: unknown): { label: string; bg: string; fg: string; border: string; pulse?: boolean } {
    const state = String(stateRaw || "").toUpperCase();
    if (["EXECUTING", "RUNNING", "IN_PRODUCTION"].includes(state)) {
        return { label: "RUNNING", bg: "rgba(37,99,235,.12)", fg: "var(--br-700)", border: "rgba(37,99,235,.28)", pulse: true };
    }
    if (state === "REPLAN_REQUIRED" || state === "PARTIAL") {
        return { label: "REPLAN", bg: "rgba(245,158,11,.13)", fg: "var(--a-700)", border: "rgba(245,158,11,.30)" };
    }
    if (state === "RELEASED") {
        return { label: "RELEASED", bg: "rgba(99,102,241,.12)", fg: "var(--i-700)", border: "rgba(99,102,241,.28)" };
    }
    if (state === "WCM_HANDOFF_READY" || state === "PLANNED") {
        return { label: "WCM HANDOFF", bg: "rgba(14,165,233,.10)", fg: "var(--info)", border: "rgba(14,165,233,.26)" };
    }
    if (state === "WAITING") {
        return { label: "WAITING", bg: "rgba(245,158,11,.12)", fg: "var(--a-700)", border: "rgba(245,158,11,.26)" };
    }
    if (state === "PAUSED" || state === "BLOCKED") {
        return { label: state || "BLOCKED", bg: "rgba(244,63,94,.12)", fg: "var(--r-700)", border: "rgba(244,63,94,.26)" };
    }
    return { label: state || "LIVE", bg: "var(--surface-2)", fg: "var(--text-3)", border: "var(--border-soft)" };
}

function orderState(order: PlannerControlOrder): string {
    if (order.partial_replan_required || String(order.line_status || "").toUpperCase() === "PARTIAL") return "REPLAN_REQUIRED";
    return String(order.production_trace?.job_state || order.production_trace?.wcm_handoff_state || order.status || "").toUpperCase();
}

function isClosedLine(order: PlannerControlOrder) {
    return ["CANCELLED", "SHORT_CLOSED", "COMPLETED"].includes(String(order.line_status || "").toUpperCase());
}

export default function LiveProductionTab() {
    const [search, setSearch] = useState("");
    const [stateFilter, setStateFilter] = useState<"all" | "running" | "released" | "waiting" | "replan" | "blocked">("all");
    const [pathFilter, setPathFilter] = useState<"all" | "production" | "handoff" | "replan">("all");
    const [page, setPage] = useState(1);

    const jobsQ = useQuery({
        queryKey: ["planner-jobs-lp-current"],
        queryFn: () => plannerService.getJobs({
            limit: 180,
            states: ["PLANNED", "RELEASED", "WAITING", "EXECUTING", "RUNNING", "PAUSED", "COMPLETED"],
            timeout_ms: 15000,
        }),
        refetchInterval: 30_000,
        staleTime: 15_000,
        meta: { suppressGlobalError: true },
    });
    const dashboardQ = useQuery({
        queryKey: ["planner-dashboard-lp-current"],
        queryFn: () => analyticsApi.getPlannerDashboard(),
        refetchInterval: 30_000,
        staleTime: 20_000,
        meta: { suppressGlobalError: true },
    });
    const hubQ = useQuery({
        queryKey: ["planner-control-hub-lp-current"],
        queryFn: () => plannerService.getControlHub({ v2: true, summary: true, planning_limit: 0, active_limit: 60, history_limit: 0, timeout_ms: 12000 }),
        refetchInterval: 45_000,
        staleTime: 20_000,
        meta: { suppressGlobalError: true },
    });

    const jobs: any[] = jobsQ.data ?? [];
    const trend = Array.isArray((dashboardQ.data as any)?.production_trend) ? (dashboardQ.data as any).production_trend : [];
    const activeOrders = hubQ.data?.active_orders ?? [];

    const jobsByOrder = useMemo(() => {
        const map = new Map<string, any[]>();
        for (const job of jobs) {
            const keys = [
                job.order_number,
                job.sales_order_number,
                job.mts_order_number,
                String(job.job_number || "").split("-B")[0],
            ].filter(Boolean);
            for (const key of keys) {
                const k = String(key);
                if (!map.has(k)) map.set(k, []);
                map.get(k)!.push(job);
            }
        }
        return map;
    }, [jobs]);

    const visibleOrders = useMemo(() => {
        let rows = activeOrders.filter((order) => !isClosedLine(order));
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            rows = rows.filter((order) => `${order.order_number} ${order.line_label || ""} ${order.template_name || ""} ${(order as any).customer_name || ""} ${order.product_master_label || ""}`.toLowerCase().includes(q));
        }
        if (stateFilter !== "all") {
            rows = rows.filter((order) => {
                const state = orderState(order);
                const blockers = ((order as any).blockers as any[] | undefined)?.length || 0;
                if (stateFilter === "running") return ["EXECUTING", "RUNNING", "IN_PRODUCTION"].includes(state);
                if (stateFilter === "released") return ["RELEASED", "WCM_HANDOFF_READY", "PLANNED"].includes(state);
                if (stateFilter === "waiting") return ["WAITING", "PAUSED"].includes(state);
                if (stateFilter === "replan") return state === "REPLAN_REQUIRED";
                if (stateFilter === "blocked") return blockers > 0 || state === "BLOCKED";
                return true;
            });
        }
        if (pathFilter !== "all") {
            rows = rows.filter((order) => {
                const state = orderState(order);
                if (pathFilter === "replan") return state === "REPLAN_REQUIRED";
                if (pathFilter === "handoff") return ["WCM_HANDOFF_READY", "PLANNED", "RELEASED"].includes(state);
                return ["EXECUTING", "RUNNING", "IN_PRODUCTION", "WAITING", "PAUSED"].includes(state);
            });
        }
        return rows;
    }, [activeOrders, pathFilter, search, stateFilter]);
    const pageSize = 8;
    const pageCount = Math.max(1, Math.ceil(visibleOrders.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const pagedOrders = visibleOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const kpis = useMemo(() => {
        let running = 0;
        let released = 0;
        let waiting = 0;
        let replan = 0;
        let blockers = 0;
        let producedKg = 0;
        let openKg = 0;
        for (const order of activeOrders) {
            const state = orderState(order);
            if (["EXECUTING", "RUNNING", "IN_PRODUCTION"].includes(state)) running++;
            if (["RELEASED", "WCM_HANDOFF_READY", "PLANNED"].includes(state)) released++;
            if (["WAITING", "PAUSED"].includes(state)) waiting++;
            if (state === "REPLAN_REQUIRED") replan++;
            blockers += ((order as any).blockers as any[] | undefined)?.length || 0;
            producedKg += Number(order.production_trace?.produced_qty || order.partial_produced_kg || order.qty_final_output || 0);
            openKg += Number(order.production_trace?.remaining_qty || order.qty_replan_remaining_kg || order.partial_shortfall_kg || order.required_qty_kg || 0);
        }
        return [
            { eyebrow: "Live lines", value: fmt(activeOrders.length), sub: "released, WCM, running", accent: "info" as const },
            { eyebrow: "Running", value: fmt(running), sub: "machine active", accent: running ? "success" as const : "default" as const },
            { eyebrow: "WCM handoff", value: fmt(released), sub: "released / ready", accent: "info" as const },
            { eyebrow: "Waiting", value: fmt(waiting), sub: "paused or blocked at WC", accent: waiting ? "warn" as const : "default" as const },
            { eyebrow: "Replan", value: fmt(replan), sub: "partial output", accent: replan ? "warn" as const : "default" as const },
            { eyebrow: "Blockers", value: fmt(blockers), sub: "release / material / artwork", accent: blockers ? "danger" as const : "default" as const },
            { eyebrow: "Produced KG", value: fmt(producedKg, 0), sub: "posted output", accent: "success" as const },
            { eyebrow: "Open KG", value: fmt(openKg, 0), sub: "remaining in live lines", accent: "info" as const },
        ];
    }, [activeOrders]);

    const exceptions = useMemo(() => {
        return activeOrders
            .filter((order) => orderState(order) === "REPLAN_REQUIRED" || (((order as any).blockers as any[] | undefined)?.length || 0) > 0)
            .slice(0, 8);
    }, [activeOrders]);

    const trendData = useMemo(
        () => trend.map((row: any) => ({ date: String(row.date || "").slice(5), output_kg: Number(row.output_kg || 0) })),
        [trend],
    );

    function refreshAll() {
        jobsQ.refetch();
        hubQ.refetch();
        dashboardQ.refetch();
    }

    return (
        <div className="ct-live-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <style>{`
                .ct-live-page {
                    scroll-behavior: smooth;
                    min-width: 0;
                }
                .ct-live-filters {
                    display: grid;
                    grid-template-columns: minmax(260px, 1fr) auto auto;
                    gap: 10px;
                    align-items: center;
                }
                .ct-live-grid {
                    display: grid;
                    grid-template-columns: minmax(0, 1.45fr) minmax(280px, .68fr);
                    gap: 16px;
                    align-items: start;
                }
                .ct-live-list {
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                    min-width: 0;
                }
                .ct-live-aside {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    position: sticky;
                    top: 12px;
                    max-height: calc(100vh - 24px);
                    overflow: auto;
                    overscroll-behavior: contain;
                    scrollbar-gutter: stable;
                    -webkit-overflow-scrolling: touch;
                }
                .ct-live-order-card {
                    content-visibility: auto;
                    contain-intrinsic-size: 680px;
                }
                .ct-live-order-card .ds-card {
                    transform: translateZ(0);
                }
                @media (max-width: 1180px) {
                    .ct-live-grid {
                        grid-template-columns: minmax(0, 1fr);
                    }
                    .ct-live-aside {
                        position: static;
                        max-height: none;
                        overflow: visible;
                    }
                }
                @media (max-width: 880px) {
                    .ct-live-filters {
                        grid-template-columns: minmax(0, 1fr);
                    }
                }
                @media (max-width: 680px) {
                    .ct-live-page {
                        gap: 12px;
                    }
                    .ct-live-list {
                        gap: 8px;
                    }
                }
            `}</style>
            <Hero
                eyebrow="Planner Control Tower · Live"
                title="Live Production"
                subtitle="Released lines, WCM handoff, running jobs, partial replan, and route-wise production trace."
                actions={
                    <Button variant="ghost" onClick={refreshAll}>
                        <RefreshCw size={14} className={jobsQ.isFetching || hubQ.isFetching ? "spin" : ""} style={{ marginRight: 6 }} />
                        Refresh
                    </Button>
                }
                kpis={kpis as any}
            />

            <Card>
                <div className="ct-live-filters">
                    <div style={{ position: "relative", minWidth: 0 }}>
                        <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-4)" }} />
                        <input
                            value={search}
                            onChange={(event) => {
                                setSearch(event.target.value);
                                setPage(1);
                            }}
                            placeholder="Search live order, customer, product master, route"
                            style={{ width: "100%", padding: "10px 12px 10px 34px", border: "1px solid var(--border-soft)", borderRadius: "var(--r-pill)", background: "var(--surface-1)", fontSize: 13, outline: "none" }}
                        />
                    </div>
                    <Segmented
                        label="State"
                        value={stateFilter}
                        onChange={(v) => {
                            setStateFilter(v as typeof stateFilter);
                            setPage(1);
                        }}
                        options={[
                            ["all", "All states"],
                            ["running", "Running"],
                            ["released", "Released"],
                            ["waiting", "Waiting"],
                            ["replan", "Replan"],
                            ["blocked", "Blockers"],
                        ]}
                    />
                    <Segmented
                        label="Path"
                        value={pathFilter}
                        onChange={(v) => {
                            setPathFilter(v as typeof pathFilter);
                            setPage(1);
                        }}
                        options={[
                            ["all", "All paths"],
                            ["handoff", "WCM handoff"],
                            ["production", "In production"],
                            ["replan", "Replan"],
                        ]}
                    />
                </div>
            </Card>

            <div className="ct-live-grid">
                <div className="ct-live-list">
                    {hubQ.isLoading ? (
                        <Card><div style={{ padding: 36, color: "var(--text-4)", textAlign: "center" }}>Loading live production...</div></Card>
                    ) : visibleOrders.length === 0 ? (
                        <Card><EmptyState title="No live orders match" body="Released, WCM handoff, running, waiting, and replan-required orders appear here." /></Card>
                    ) : (
                        <>
                            <PaginationBar
                                total={visibleOrders.length}
                                page={currentPage}
                                pageCount={pageCount}
                                pageSize={pageSize}
                                onPrev={() => setPage((value) => Math.max(1, value - 1))}
                                onNext={() => setPage((value) => Math.min(pageCount, value + 1))}
                            />
                            {pagedOrders.map((order) => (
                                <LiveOrderCard
                                    key={`${order.order_kind}:${order.order_id}:${order.sales_order_item_id || "order"}`}
                                    order={order}
                                    jobs={jobsByOrder.get(order.order_number) || []}
                                />
                            ))}
                            <PaginationBar
                                total={visibleOrders.length}
                                page={currentPage}
                                pageCount={pageCount}
                                pageSize={pageSize}
                                onPrev={() => setPage((value) => Math.max(1, value - 1))}
                                onNext={() => setPage((value) => Math.min(pageCount, value + 1))}
                            />
                        </>
                    )}
                </div>

                <div className="ct-live-aside">
                    <Card>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", marginBottom: 10 }}>
                            <div>
                                <div className="t-eyebrow">Release blockers</div>
                                <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text-1)", marginTop: 2 }}>Subtle exceptions to clear</div>
                            </div>
                            <AlertTriangle size={16} color="var(--text-3)" />
                        </div>
                        {exceptions.length === 0 ? (
                            <EmptyState title="No live blockers" body="No replan or blocker signals in live production." />
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                                {exceptions.map((order) => (
                                    <div key={`${order.order_kind}:${order.order_id}:${order.sales_order_item_id || "order"}`} style={{ padding: "10px 12px", border: "1px solid rgba(245,158,11,.18)", borderRadius: "var(--r-3)", background: "rgba(245,158,11,.06)" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                                            <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 900, color: "var(--text-1)" }}>{order.order_number}</span>
                                            <Chip kind={orderState(order) === "REPLAN_REQUIRED" ? "paused" : "blocked"}>{orderState(order)}</Chip>
                                        </div>
                                        <div style={{ marginTop: 4, fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                            {order.line_label || order.template_name}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Card>

                    <Card>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", marginBottom: 10 }}>
                            <div>
                                <div className="t-eyebrow">Output rhythm</div>
                                <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text-1)", marginTop: 2 }}>30-day posted KG</div>
                            </div>
                            <Activity size={16} color="var(--text-3)" />
                        </div>
                        {trendData.length === 0 ? (
                            <EmptyState title="No trend data" body="Output history populates as jobs close." />
                        ) : (
                            <div style={{ height: 220 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={trendData} margin={{ top: 12, right: 6, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="lp-current-area" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#2563eb" stopOpacity={0.26} />
                                                <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                                        <Tooltip contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-3)", fontSize: 12 }} />
                                        <Area type="monotone" dataKey="output_kg" stroke="#1d4ed8" fill="url(#lp-current-area)" strokeWidth={2} dot={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
}

function PaginationBar({
    total,
    page,
    pageCount,
    pageSize,
    onPrev,
    onNext,
}: {
    total: number;
    page: number;
    pageCount: number;
    pageSize: number;
    onPrev: () => void;
    onNext: () => void;
}) {
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(total, page * pageSize);
    return (
        <Card style={{ padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 800, color: "var(--text-3)" }}>
                    {start}-{end} of {fmt(total)} live order lines
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Button variant="secondary" size="sm" disabled={page <= 1} onClick={onPrev}>Prev</Button>
                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 900, color: "var(--text-2)" }}>
                        Page {page} / {pageCount}
                    </span>
                    <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={onNext}>Next</Button>
                </div>
            </div>
        </Card>
    );
}

function Segmented({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <Filter size={13} color="var(--text-4)" />
            <span style={{ fontSize: 9, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-4)" }}>{label}</span>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                {options.map(([key, optionLabel]) => {
                    const active = key === value;
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => onChange(key)}
                            style={{
                                padding: "6px 10px",
                                borderRadius: "var(--r-pill)",
                                border: `1px solid ${active ? "var(--brand-600)" : "var(--border-soft)"}`,
                                background: active ? "var(--br-50)" : "var(--surface-1)",
                                color: active ? "var(--br-700)" : "var(--text-2)",
                                fontSize: 11,
                                fontWeight: 800,
                                cursor: "pointer",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {optionLabel}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

function LiveOrderCard({ order, jobs }: { order: PlannerControlOrder; jobs: any[] }) {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const [resolutionMode, setResolutionMode] = useState<"cancel" | "short-close" | null>(null);
    const [reason, setReason] = useState("");
    const state = orderState(order);
    const tone = stateTone(state);
    const blockers = ((order as any).blockers as any[] | undefined) || [];
    const progress = Number(order.production_trace?.progress_pct || 0);
    const isSalesLine = order.order_kind === "sales" && !!order.sales_order_item_id;
    const lineClosed = isClosedLine(order);
    const canCancel = isSalesLine && !lineClosed;
    const canShortClose = isSalesLine && !lineClosed && (order.partial_replan_required || Number(order.partial_shortfall_kg || 0) > 0 || Number(order.qty_open || 0) > 0);

    const cancelMutation = useMutation({
        mutationFn: () => plannerService.cancelPlannedLine(order.order_kind as PlannerOrderKind, order.order_id, {
            item_id: order.sales_order_item_id || undefined,
            reason: reason.trim(),
        }),
        onSuccess: () => {
            toast({ title: "Line cancelled", description: order.line_label || order.order_number });
            setResolutionMode(null);
            setReason("");
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-lp-current"] });
        },
        onError: (err: any) => toast({ title: "Cancel failed", description: err?.response?.data?.error || err?.message || "Use short-close if production has already started.", variant: "destructive" }),
    });
    const shortCloseMutation = useMutation({
        mutationFn: () => plannerService.shortCloseOrder(order.order_kind as PlannerOrderKind, order.order_id, {
            item_id: order.sales_order_item_id || undefined,
            reason: reason.trim(),
        }),
        onSuccess: () => {
            toast({ title: "Line short-closed", description: order.line_label || order.order_number });
            setResolutionMode(null);
            setReason("");
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-lp-current"] });
        },
        onError: (err: any) => toast({ title: "Short-close failed", description: err?.response?.data?.error || err?.message || "Try again.", variant: "destructive" }),
    });

    function submitResolution() {
        if (reason.trim().length < 5) {
            toast({ title: "Reason required", description: "Enter at least 5 characters for the audit trail.", variant: "destructive" });
            return;
        }
        if (resolutionMode === "cancel") cancelMutation.mutate();
        if (resolutionMode === "short-close") shortCloseMutation.mutate();
    }

    return (
        <Card className="ct-live-order-card" style={{ borderColor: state === "REPLAN_REQUIRED" ? "rgba(245,158,11,.32)" : tone.border, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 14, alignItems: "start" }}>
                <OrderPassportStrip order={order} />
                <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                    <span style={{ padding: "4px 10px", borderRadius: "var(--r-pill)", border: `1px solid ${tone.border}`, background: tone.bg, color: tone.fg, fontSize: 10, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".05em", animation: tone.pulse ? "ds-pulse 1.8s var(--eo) infinite" : "none" }}>
                        {tone.label}
                    </span>
                    <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 900, color: "var(--text-1)", whiteSpace: "nowrap" }}>
                        {fmt(order.production_trace?.produced_qty || order.partial_produced_kg || 0, 1)} / {fmt(order.production_trace?.planned_qty || order.required_qty_kg || 0, 0)} {order.production_trace?.uom || order.qty_uom || "KG"}
                    </div>
                </div>
            </div>

            <div style={{ marginTop: 12, height: 8, borderRadius: 999, overflow: "hidden", background: "var(--surface-2)" }}>
                <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, progress))}%`, background: state === "REPLAN_REQUIRED" ? "var(--warning)" : "linear-gradient(90deg, var(--br-500), var(--e-500))", transition: "width var(--ds) var(--eo)" }} />
            </div>

            {blockers.length > 0 && (
                <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {blockers.slice(0, 4).map((blocker: any, index: number) => (
                        <span key={index} style={{ padding: "4px 8px", borderRadius: "var(--r-pill)", background: "rgba(244,63,94,.08)", color: "var(--danger)", fontSize: 10, fontWeight: 800 }}>
                            {blocker.message || blocker.code || "Blocker"}
                        </span>
                    ))}
                </div>
            )}

            <div style={{ marginTop: 14 }}>
                <ProductionTracePanel order={order} dense liveJobs={jobs} mode="live" />
            </div>

            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--border-soft)", display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "start" }}>
                <ActionRuleNote order={order} canCancel={canCancel} canShortClose={canShortClose} />
                {isSalesLine && (
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <Button variant="warn" size="sm" disabled={!canShortClose || shortCloseMutation.isPending || cancelMutation.isPending} onClick={() => { setResolutionMode("short-close"); setReason(""); }}>
                            <PauseCircle size={13} style={{ marginRight: 6 }} />
                            Short close
                        </Button>
                        <Button variant="danger" size="sm" disabled={!canCancel || shortCloseMutation.isPending || cancelMutation.isPending} onClick={() => { setResolutionMode("cancel"); setReason(""); }}>
                            <X size={13} style={{ marginRight: 6 }} />
                            Cancel line
                        </Button>
                    </div>
                )}
            </div>

            {resolutionMode && (
                <div role="dialog" aria-modal="true" onClick={() => setResolutionMode(null)} style={{ position: "fixed", inset: 0, zIndex: "var(--z-modal)" as any, background: "rgba(15,23,42,.42)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                    <div onClick={(event) => event.stopPropagation()} style={{ width: "min(520px, 100%)", borderRadius: "var(--r-5)", border: "1px solid var(--border-soft)", background: "var(--surface-1)", boxShadow: "var(--sh-lg)", padding: 20 }}>
                        <div className="t-eyebrow">{resolutionMode === "cancel" ? "Cancel live sales line" : "Short-close live sales line"}</div>
                        <div style={{ marginTop: 6, fontSize: 18, fontWeight: 900, color: "var(--text-1)" }}>{order.line_label || order.order_number}</div>
                        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-3)" }}>
                            {resolutionMode === "cancel"
                                ? "The API will reject cancellation if production activity means the line must be short-closed instead."
                                : "Closes unresolved remaining quantity while preserving posted production for dispatch and trace."}
                        </div>
                        <textarea
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            placeholder="Planner override reason visible in audit trail"
                            style={{ marginTop: 14, width: "100%", minHeight: 96, resize: "vertical", padding: 12, borderRadius: "var(--r-3)", border: "1px solid var(--border-soft)", background: "var(--surface-2)", color: "var(--text-1)", fontSize: 13, outline: "none" }}
                        />
                        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                            <Button variant="ghost" onClick={() => setResolutionMode(null)}>Close</Button>
                            <Button variant={resolutionMode === "cancel" ? "danger" : "warn"} disabled={cancelMutation.isPending || shortCloseMutation.isPending} onClick={submitResolution}>
                                {resolutionMode === "cancel" ? "Cancel line" : "Short close line"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </Card>
    );
}

function ActionRuleNote({ order, canCancel, canShortClose }: { order: PlannerControlOrder; canCancel: boolean; canShortClose: boolean }) {
    const lineClosed = isClosedLine(order);
    const isSalesLine = order.order_kind === "sales" && !!order.sales_order_item_id;
    const cancelReason = !isSalesLine
        ? "Cancel override is sales-line only here; stock orders use their own lifecycle action."
        : lineClosed
        ? "Cancel is locked because this line is already closed."
        : canCancel
        ? "Cancel is allowed until machine/material/scrap activity exists; backend will reject once activity is posted."
        : "Cancel is not currently available for this line.";
    const shortCloseReason = !isSalesLine
        ? "Short-close from this desk is for sales lines; stock short-close only applies before stock production is released."
        : lineClosed
        ? "Short-close is locked because this line is already closed."
        : canShortClose
        ? "Short-close keeps posted production and closes only the unresolved remaining quantity with an audit reason."
        : "Short-close appears when an open balance, partial output, or replan shortfall exists.";
    const wcmReason = "WCM machine close records actual job output, scrap, and variance. Planner short-close is only for the sales-line balance after WCM has posted what was really produced.";
    return (
        <div style={{ minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap: 8 }}>
            <RulePill label="Cancel rule" value={cancelReason} enabled={canCancel} />
            <RulePill label="Short-close rule" value={shortCloseReason} enabled={canShortClose} />
            <RulePill label="WCM machine close" value={wcmReason} enabled />
        </div>
    );
}

function RulePill({ label, value, enabled }: { label: string; value: string; enabled: boolean }) {
    return (
        <div style={{ padding: "8px 10px", borderRadius: "var(--r-3)", border: `1px solid ${enabled ? "rgba(37,99,235,.22)" : "var(--border-soft)"}`, background: enabled ? "rgba(37,99,235,.06)" : "var(--surface-2)" }}>
            <div style={{ fontSize: 8, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".06em", color: enabled ? "var(--br-700)" : "var(--text-4)" }}>{label}</div>
            <div style={{ marginTop: 3, fontSize: 10, lineHeight: 1.35, color: "var(--text-3)" }}>{value}</div>
        </div>
    );
}

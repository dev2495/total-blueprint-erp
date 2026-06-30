"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    ChevronDown,
    ChevronRight,
    Download,
    History,
    Package,
    RefreshCw,
    Search,
    Settings2,
    TrendingUp,
} from "lucide-react";
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

import { plannerService, type PlannerControlOrder } from "@/services/planner";
import { Card, Hero, Button, EmptyState, Chip } from "@/components/_planner-ui";
import { ageInfo, ageToneColor } from "../_shared/age";
import { getOrderPassport, OrderPassportStrip, PassportDetailGrid, ProductionTracePanel } from "../order-passport";
import { formatDisplayDateTime } from "@/lib/date-format";

function fmt(n: any, decimals = 0) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function timeAgo(iso?: string | null) {
    if (!iso) return "—";
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return "—";
    const ms = Date.now() - t;
    const min = Math.floor(ms / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}

function fmtDateTime(iso?: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return formatDisplayDateTime(d);
}

function getCompletedAt(o: PlannerControlOrder): string | null {
    return ((o as any).completed_at || (o as any).closed_at || null) as string | null;
}

function getPlacedAt(o: PlannerControlOrder): string | null {
    return ((o as any).created_at || null) as string | null;
}

function cycleTimeDays(o: PlannerControlOrder): number | null {
    const placed = getPlacedAt(o);
    const completed = getCompletedAt(o);
    if (!placed || !completed) return null;
    const p = new Date(placed).getTime();
    const c = new Date(completed).getTime();
    if (Number.isNaN(p) || Number.isNaN(c)) return null;
    return Math.max(0, (c - p) / (1000 * 60 * 60 * 24));
}

function isOnTime(o: PlannerControlOrder): boolean | null {
    const completed = getCompletedAt(o);
    const due = (o as any).delivery_date as string | null | undefined;
    if (!completed || !due) return null;
    const c = new Date(completed).getTime();
    const d = new Date(due).getTime();
    if (Number.isNaN(c) || Number.isNaN(d)) return null;
    return c <= d + 24 * 60 * 60 * 1000; // 1-day grace
}

type PeriodKey = "24h" | "7d" | "30d" | "90d";
const PERIODS: { key: PeriodKey; label: string; ms: number; days: number }[] = [
    { key: "24h", label: "Today", ms: 24 * 60 * 60 * 1000, days: 1 },
    { key: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000, days: 7 },
    { key: "30d", label: "30 days", ms: 30 * 24 * 60 * 60 * 1000, days: 30 },
    { key: "90d", label: "90 days", ms: 90 * 24 * 60 * 60 * 1000, days: 90 },
];

const SOURCE_COLORS: Record<string, string> = {
    FG: "#10b981",
    WIP: "#6366f1",
    FRESH: "#2563eb",
    CLAIM: "#0f766e",
    OTHER: "#94a3b8",
};

type AuditFilter = "all" | "wcm_posted" | "stock_claim" | "variance" | "late" | "trace_gap";

function traceAudit(order: PlannerControlOrder) {
    const trace: any = order.production_trace || {};
    const integrity: any = trace.trace_integrity || {};
    const state = String(integrity.state || trace.audit_status || "").toUpperCase();
    const mode = String(trace.completion_mode || "").toUpperCase();
    const jobState = String(trace.job_state || trace.wcm_handoff_state || order.status || order.line_status || "").toUpperCase();
    const closed = ["COMPLETED", "DONE", "PACKING_READY", "SHORT_CLOSED", "CLOSED"].includes(jobState) || !!state || !!getCompletedAt(order);
    const hasJobs = Array.isArray(trace.jobs) ? trace.jobs.length > 0 : Number(trace.jobs_completed || trace.job_count || 0) > 0;
    const claimedNoWcm = mode === "STOCK_OR_PACKING_CLAIM" || state === "CLAIMED_NO_WCM_LOG" || (closed && !hasJobs);
    const postedWithVariance = state === "POSTED_WITH_VARIANCE" || jobState === "SHORT_CLOSED" || Number(trace.closure_variance_qty || 0) > 0;
    const late = isOnTime(order) === false;
    const traceGap = closed && !claimedNoWcm && !hasJobs;
    return {
        closed,
        state: state || (claimedNoWcm ? "CLAIMED_NO_WCM_LOG" : postedWithVariance ? "POSTED_WITH_VARIANCE" : hasJobs ? "WCM_POSTED" : "LIVE"),
        claimedNoWcm,
        hasJobs,
        postedWithVariance,
        late,
        traceGap,
        message: String(integrity.message || ""),
        postedKg: Number(trace.produced_qty || 0),
        closureVarianceKg: Number(trace.closure_variance_qty || 0),
    };
}

function sourcePath(order: PlannerControlOrder): "FG" | "WIP" | "FRESH" | "CLAIM" {
    const audit = traceAudit(order);
    if (audit.claimedNoWcm) return "CLAIM";
    const analyticsPath = String((order as any).analytics?.source_path || "").toUpperCase();
    if (analyticsPath === "FG") return "FG";
    if (analyticsPath === "WIP" || analyticsPath === "UPSTREAM") return "WIP";
    const fg = !!order.source_availability?.has_fg;
    const wip = !!order.source_availability?.has_wip;
    return fg ? "FG" : wip ? "WIP" : "FRESH";
}

function auditMatches(order: PlannerControlOrder, filter: AuditFilter): boolean {
    const audit = traceAudit(order);
    if (filter === "all") return true;
    if (filter === "wcm_posted") return audit.hasJobs && !audit.claimedNoWcm;
    if (filter === "stock_claim") return audit.claimedNoWcm;
    if (filter === "variance") return audit.postedWithVariance;
    if (filter === "late") return audit.late;
    if (filter === "trace_gap") return audit.traceGap;
    return true;
}

function searchText(order: PlannerControlOrder): string {
    const passport = getOrderPassport(order);
    const trace: any = order.production_trace || {};
    return [
        order.order_number,
        order.template_name,
        order.line_label,
        (order as any).customer_name,
        order.status,
        order.line_status,
        passport.productMaster,
        passport.displayName,
        passport.sizeLabel,
        passport.thicknessExpression,
        passport.layerRecipeLabel,
        passport.materialFamily,
        passport.printLabel,
        passport.packagingLabel,
        trace.job_state,
        trace.audit_status,
        trace.completion_mode,
    ].filter(Boolean).join(" ").toLowerCase();
}

function exportCsv(rows: PlannerControlOrder[]) {
    const header = ["order_number", "template_name", "fg_type", "customer", "required_qty_kg", "placed_at", "completed_at", "cycle_days", "on_time", "qty_uom"];
    const lines = [header.join(",")];
    for (const r of rows) {
        const ct = cycleTimeDays(r);
        const ot = isOnTime(r);
        lines.push([
            r.order_number,
            JSON.stringify(r.template_name || ""),
            r.fg_type || r.final_product_type || "",
            JSON.stringify((r as any).customer_name || ""),
            String(r.required_qty_kg ?? ""),
            String(getPlacedAt(r) || ""),
            String(getCompletedAt(r) || ""),
            ct != null ? ct.toFixed(1) : "",
            ot == null ? "" : ot ? "yes" : "no",
            r.qty_uom || "",
        ].join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `completed-trace-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

export default function CompletedTraceTab() {
    const [period, setPeriod] = useState<PeriodKey>("90d");
    const [search, setSearch] = useState("");
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [customerFilter, setCustomerFilter] = useState<string>("all");
    const [sourceFilter, setSourceFilter] = useState<"all" | "FG" | "WIP" | "FRESH" | "CLAIM">("all");
    const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");
    const [page, setPage] = useState(1);

    const periodCfg = PERIODS.find((p) => p.key === period)!;

    const hubQ = useQuery({
        queryKey: ["planner-control-hub-ct-trace-v3", period],
        queryFn: () => plannerService.getControlHub({
            summary: true,
            history_days: periodCfg.days,
            history_limit: 200,
            planning_limit: 0,
            active_limit: 50,
            timeout_ms: 12000,
        }),
        staleTime: 30_000,
        refetchInterval: 90_000,
    });

    const history = hubQ.data?.order_history ?? [];

    const cutoff = Date.now() - periodCfg.ms;
    const priorCutoff = Date.now() - periodCfg.ms * 2;

    const inPeriod = useMemo(() => {
        return history.filter((o) => {
            const c = getCompletedAt(o);
            if (!c) return traceAudit(o).closed; // PACKING_READY / short-close history can be closed without completed_at.
            const t = new Date(c).getTime();
            return Number.isFinite(t) && t >= cutoff;
        });
    }, [history, cutoff]);

    const priorPeriod = useMemo(() => {
        return history.filter((o) => {
            const c = getCompletedAt(o);
            if (!c) return false;
            const t = new Date(c).getTime();
            return Number.isFinite(t) && t >= priorCutoff && t < cutoff;
        });
    }, [history, priorCutoff, cutoff]);

    const filtered = useMemo(() => {
        let rows = inPeriod;
        if (search) {
            const q = search.toLowerCase();
            rows = rows.filter((o) => searchText(o).includes(q));
        }
        if (customerFilter !== "all") {
            rows = rows.filter((o) => (o as any).customer_name === customerFilter);
        }
        if (sourceFilter !== "all") {
            rows = rows.filter((o) => sourcePath(o) === sourceFilter);
        }
        if (auditFilter !== "all") {
            rows = rows.filter((o) => auditMatches(o, auditFilter));
        }
        return rows;
    }, [inPeriod, search, customerFilter, sourceFilter, auditFilter]);
    const pageSize = 18;
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    const currentPage = Math.min(page, pageCount);
    const pagedRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    const distinctCustomers = useMemo(() => {
        const s = new Set<string>();
        inPeriod.forEach((o) => { const c = (o as any).customer_name; if (c) s.add(c); });
        return Array.from(s).sort();
    }, [inPeriod]);

    // ----- KPIs with prior-period deltas -----
    const kpis = useMemo(() => {
        const closedNow = inPeriod.length;
        const closedPrior = priorPeriod.length;
        const totalKgNow = inPeriod.reduce((s, o) => s + Number(o.required_qty_kg || 0), 0);
        const totalKgPrior = priorPeriod.reduce((s, o) => s + Number(o.required_qty_kg || 0), 0);
        const audits = inPeriod.map(traceAudit);
        const postedKg = audits.reduce((sum, audit, index) => {
            const order = inPeriod[index];
            return sum + (audit.hasJobs ? Number((order.production_trace as any)?.produced_qty || 0) : 0);
        }, 0);
        const claimedCount = audits.filter((audit) => audit.claimedNoWcm).length;
        const varianceCount = audits.filter((audit) => audit.postedWithVariance).length;
        const traceGapCount = audits.filter((audit) => audit.traceGap).length;

        // Cycle time
        const cycles = inPeriod.map(cycleTimeDays).filter((v): v is number => v != null);
        const avgCycle = cycles.length > 0 ? cycles.reduce((a, b) => a + b, 0) / cycles.length : 0;
        const medianCycle = cycles.length > 0 ? [...cycles].sort((a, b) => a - b)[Math.floor(cycles.length / 2)] : 0;

        // On-time
        const onTimeData = inPeriod.map(isOnTime).filter((v): v is boolean => v != null);
        const onTimeCount = onTimeData.filter((v) => v).length;
        const onTimePct = onTimeData.length > 0 ? (onTimeCount / onTimeData.length) * 100 : 0;

        const buildKpi = (eyebrow: string, now: number, prior: number, sub: string, decimals = 0) => {
            const delta = prior > 0 ? ((now - prior) / prior) * 100 : now > 0 ? 100 : 0;
            const dir = delta > 1 ? "up" : delta < -1 ? "down" : "flat";
            const accent: any = dir === "up" ? "success" : dir === "down" ? "danger" : "default";
            return {
                eyebrow,
                value: fmt(now, decimals),
                sub: `${dir === "up" ? "+" : dir === "down" ? "" : "±"}${Math.abs(delta).toFixed(0)}% vs prior · ${sub}`,
                accent,
            };
        };

        return [
            buildKpi("Closed lines", closedNow, closedPrior, "audit rows"),
            buildKpi("Demand KG", totalKgNow, totalKgPrior, "closed demand", 1),
            { eyebrow: "WCM posted", value: fmt(postedKg, 1), sub: `${audits.filter((audit) => audit.hasJobs).length} lines with job logs`, accent: postedKg > 0 ? "success" as const : "default" as const },
            { eyebrow: "Stock claims", value: fmt(claimedCount), sub: "closed without WCM rows", accent: claimedCount > 0 ? "info" as const : "default" as const },
            { eyebrow: "Avg cycle", value: avgCycle > 0 ? `${avgCycle.toFixed(1)}d` : "—", sub: `median ${medianCycle.toFixed(1)}d (placed -> closed)`, accent: avgCycle > 14 ? "warn" as const : "info" as const },
            { eyebrow: "On-time", value: onTimeData.length > 0 ? pct(onTimePct) : "—", sub: `${onTimeCount} of ${onTimeData.length} measurable`, accent: onTimePct >= 80 ? "success" as const : onTimePct >= 50 ? "warn" as const : "danger" as const },
            { eyebrow: "Short close", value: fmt(varianceCount), sub: "variance closures", accent: varianceCount > 0 ? "warn" as const : "default" as const },
            { eyebrow: "Trace gaps", value: fmt(traceGapCount), sub: "needs audit follow-up", accent: traceGapCount > 0 ? "danger" as const : "success" as const },
        ];
    }, [inPeriod, priorPeriod]);

    // ----- Source path mix -----
    const sourceDist = useMemo(() => {
        const counts: Record<string, number> = { FG: 0, WIP: 0, FRESH: 0, CLAIM: 0 };
        for (const o of inPeriod) {
            counts[sourcePath(o)]++;
        }
        return Object.entries(counts).filter(([_, v]) => v > 0).map(([name, value]) => ({ name, value }));
    }, [inPeriod]);

    const auditCounts = useMemo(() => {
        const filters: AuditFilter[] = ["all", "wcm_posted", "stock_claim", "variance", "late", "trace_gap"];
        return Object.fromEntries(filters.map((filter) => [filter, inPeriod.filter((order) => auditMatches(order, filter)).length])) as Record<AuditFilter, number>;
    }, [inPeriod]);

    // ----- Throughput by day chart -----
    const throughput = useMemo(() => {
        const map: Map<string, { date: string; orders: number; kg: number }> = new Map();
        for (const o of inPeriod) {
            const c = getCompletedAt(o);
            if (!c) continue;
            const d = new Date(c);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            if (!map.has(key)) map.set(key, { date: key.slice(5), orders: 0, kg: 0 });
            const e = map.get(key)!;
            e.orders++;
            e.kg += Number(o.required_qty_kg || 0);
        }
        return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    }, [inPeriod]);

    // ----- Top templates -----
    const topTemplates = useMemo(() => {
        const map: Map<string, { name: string; orders: number; kg: number }> = new Map();
        for (const o of inPeriod) {
            const k = o.template_name || "Unknown";
            if (!map.has(k)) map.set(k, { name: k, orders: 0, kg: 0 });
            const e = map.get(k)!;
            e.orders++;
            e.kg += Number(o.required_qty_kg || 0);
        }
        return Array.from(map.values()).sort((a, b) => b.kg - a.kg).slice(0, 6);
    }, [inPeriod]);

    const toggleExpand = (key: string) => setExpanded((s) => ({ ...s, [key]: !s[key] }));

    return (
        <div className="ct-completed-page" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <style>{`
                .ct-completed-page {
                    display: flex;
                    flex-direction: column;
                    scroll-behavior: smooth;
                    min-width: 0;
                }
                .ct-completed-filters {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 12px;
                    align-items: center;
                    justify-content: space-between;
                }
                .ct-completed-chart-grid {
                    display: grid;
                    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
                    gap: 16px;
                    order: 3;
                }
                .ct-completed-main-grid {
                    display: grid;
                    grid-template-columns: minmax(0, 2fr) minmax(280px, .82fr);
                    gap: 16px;
                    align-items: start;
                    order: 2;
                }
                .ct-completed-filter-card {
                    order: 1;
                }
                .ct-completed-chart-card {
                    min-width: 0;
                }
                .ct-completed-chart-shell {
                    width: 100%;
                    min-width: 0;
                    min-height: 180px;
                }
                .ct-completed-aside {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    position: sticky;
                    top: 12px;
                    align-self: start;
                    max-height: calc(100vh - 24px);
                    overflow: auto;
                    overscroll-behavior: contain;
                    scrollbar-gutter: stable;
                    -webkit-overflow-scrolling: touch;
                }
                .ct-completed-row {
                    content-visibility: auto;
                    contain-intrinsic-size: 96px;
                }
                @media (max-width: 1120px) {
                    .ct-completed-chart-grid,
                    .ct-completed-main-grid {
                        grid-template-columns: minmax(0, 1fr);
                    }
                    .ct-completed-aside {
                        position: static;
                        max-height: none;
                        overflow: visible;
                    }
                }
                @media (max-width: 720px) {
                    .ct-completed-page {
                        gap: 10px !important;
                    }
                    .ct-completed-filters > div {
                        width: 100%;
                    }
                    .ct-completed-filters input,
                    .ct-completed-filters select {
                        width: 100%;
                    }
                    .ct-completed-filter-card {
                        padding: 12px !important;
                    }
                    .ct-completed-main-grid,
                    .ct-completed-chart-grid {
                        gap: 10px;
                    }
                    .ct-completed-row-button {
                        align-items: flex-start !important;
                        padding: 12px 14px !important;
                    }
                    .ct-completed-row-meta {
                        width: 100%;
                        justify-content: flex-start !important;
                        padding-left: 24px;
                    }
                    .ct-completed-expanded {
                        padding: 0 12px 16px 34px !important;
                    }
                }
            `}</style>
            <Hero
                eyebrow="Planner Command Tower · Tab 4"
                title="Completed Trace"
                subtitle="Cycle time · on-time delivery · throughput · expandable per-order detail with full route trace and BOM."
                actions={
                    <div style={{ display: "flex", gap: 6 }}>
                        <Button variant="secondary" onClick={() => exportCsv(filtered)}>
                            <Download size={14} style={{ marginRight: 6 }} />
                            Export CSV
                        </Button>
                        <Button variant="ghost" onClick={() => hubQ.refetch()}>
                            <RefreshCw size={14} className={hubQ.isFetching ? "spin" : ""} style={{ marginRight: 6 }} />
                            Refresh
                        </Button>
                    </div>
                }
                kpis={kpis as any}
            />

            {/* Period selector + filters */}
            <Card className="ct-completed-filter-card">
                <div className="ct-completed-filters">
                    <div style={{ display: "flex", gap: 4 }}>
                        {PERIODS.map((p) => (
                            <button
                                key={p.key}
                                type="button"
                                onClick={() => {
                                    setPeriod(p.key);
                                    setPage(1);
                                }}
                                style={{
                                    padding: "8px 16px",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    background: period === p.key ? "var(--brand-600)" : "transparent",
                                    color: period === p.key ? "var(--text-on-brand)" : "var(--text-2)",
                                    border: period === p.key ? "1px solid var(--brand-600)" : "1px solid var(--border-soft)",
                                    borderRadius: "var(--r-pill)",
                                    cursor: "pointer",
                                    boxShadow: period === p.key ? "var(--glow-brand)" : "none",
                                    transition: "all var(--df) var(--eo)",
                                }}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <select
                            value={customerFilter}
                            onChange={(e) => {
                                setCustomerFilter(e.target.value);
                                setPage(1);
                            }}
                            style={{ padding: "7px 10px", fontSize: 12, fontFamily: "var(--f-ui)", background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-2)", outline: "none" }}
                        >
                            <option value="all">All customers ({distinctCustomers.length})</option>
                            {distinctCustomers.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                            {(["all", "FG", "WIP", "FRESH", "CLAIM"] as const).map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => {
                                        setSourceFilter(s);
                                        setPage(1);
                                    }}
                                    style={{
                                        padding: "5px 12px",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        background: sourceFilter === s ? (s === "all" ? "var(--brand-600)" : SOURCE_COLORS[s]) : "var(--surface-2)",
                                        color: sourceFilter === s ? "#fff" : "var(--text-2)",
                                        border: "none",
                                        borderRadius: "var(--r-pill)",
                                        cursor: "pointer",
                                    }}
                                >
                                    {s === "all" ? "All sources" : s === "CLAIM" ? "Claims" : s}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                            {([
                                ["all", "All audit"],
                                ["wcm_posted", "WCM posted"],
                                ["stock_claim", "Stock claim"],
                                ["variance", "Short close"],
                                ["late", "Late"],
                                ["trace_gap", "Trace gap"],
                            ] as const).map(([key, label]) => (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => {
                                        setAuditFilter(key);
                                        setPage(1);
                                    }}
                                    style={{
                                        padding: "5px 10px",
                                        fontSize: 11,
                                        fontWeight: 800,
                                        background: auditFilter === key ? "var(--surface-3)" : "var(--surface-1)",
                                        color: auditFilter === key ? "var(--text-1)" : "var(--text-3)",
                                        border: auditFilter === key ? "1px solid var(--brand-300)" : "1px solid var(--border-soft)",
                                        borderRadius: "var(--r-pill)",
                                        cursor: "pointer",
                                    }}
                                >
                                    {label} <span style={{ fontFamily: "var(--f-mono)", color: auditFilter === key ? "var(--br-700)" : "var(--text-4)" }}>{auditCounts[key]}</span>
                                </button>
                            ))}
                        </div>
                        <div style={{ position: "relative", minWidth: 240 }}>
                            <Search size={12} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-4)" }} />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setPage(1);
                                }}
                                placeholder="Search order, customer, PM, size, layer, status"
                                style={{
                                    width: "100%", padding: "8px 12px 8px 32px",
                                    fontSize: 12, fontFamily: "var(--f-ui)",
                                    background: "var(--surface-1)", border: "1px solid var(--border-soft)",
                                    borderRadius: "var(--r-pill)", outline: "none",
                                }}
                            />
                        </div>
                    </div>
                </div>
            </Card>

            {/* Throughput chart + Top templates */}
            <div className="ct-completed-chart-grid">
                <Card className="ct-completed-chart-card is-emphasis">
                    <SectionHeader
                        eyebrow="Throughput"
                        title="Orders closed per day"
                        icon={<TrendingUp size={16} color="var(--br-700)" />}
                        rightBadge={<BigNumber value={fmt(throughput.reduce((s, t) => s + t.kg, 0), 0)} suffix="KG total" />}
                    />
                    {throughput.length === 0 ? (
                        <EmptyState title="No throughput data" body="Once orders close in the selected period, daily throughput appears here." />
                    ) : (
                        <div className="ct-completed-chart-shell" style={{ height: 220, marginTop: 14 }}>
                            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={160} initialDimension={{ width: 720, height: 220 }}>
                                <BarChart data={throughput} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-4)" }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: "var(--text-4)" }} axisLine={false} tickLine={false} />
                                    <Tooltip contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-3)", fontSize: 12 }} />
                                    <Bar dataKey="orders" name="Orders" fill="#2563eb" radius={[3, 3, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </Card>

                <Card className="ct-completed-chart-card">
                    <SectionHeader
                        eyebrow="Top templates"
                        title="By KG shipped"
                        icon={<Package size={16} color="var(--text-3)" />}
                    />
                    {topTemplates.length === 0 ? (
                        <EmptyState title="No templates" body="Once orders close, top templates appear here." />
                    ) : (
                        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                            {(() => {
                                const max = topTemplates[0].kg || 1;
                                return topTemplates.map((t) => (
                                    <div key={t.name} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                                            <span style={{ fontWeight: 600, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {t.name}
                                            </span>
                                            <span style={{ fontFamily: "var(--f-mono)", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                                                {fmt(t.kg, 0)} KG · {t.orders}
                                            </span>
                                        </div>
                                        <div style={{ height: 5, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}>
                                            <div style={{ height: "100%", width: `${(t.kg / max) * 100}%`, background: "linear-gradient(90deg, var(--br-500), var(--br-700))" }} />
                                        </div>
                                    </div>
                                ));
                            })()}
                        </div>
                    )}
                </Card>
            </div>

            {/* Closed orders + source mix */}
            <div className="ct-completed-main-grid">
                <Card style={{ padding: 0 }}>
                    <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                            <div className="t-eyebrow">Closed orders</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                                {filtered.length} order{filtered.length === 1 ? "" : "s"} in {periodCfg.label}
                            </div>
                        </div>
                        <History size={16} color="var(--text-3)" />
                    </div>
                    {filtered.length === 0 ? (
                        <EmptyState title="No closed orders" body="Try a longer lookback window or clear the search/filters." />
                    ) : (
                        <>
                            <CompletedPaginationBar
                                total={filtered.length}
                                page={currentPage}
                                pageCount={pageCount}
                                pageSize={pageSize}
                                onPrev={() => setPage((value) => Math.max(1, value - 1))}
                                onNext={() => setPage((value) => Math.min(pageCount, value + 1))}
                            />
                            <div style={{ scrollBehavior: "smooth" }}>
                                {pagedRows.map((o) => (
                                    <CompletedOrderRow
                                        key={`${o.order_kind}:${o.order_id}`}
                                        order={o}
                                        expanded={!!expanded[`${o.order_kind}:${o.order_id}`]}
                                        onToggle={() => toggleExpand(`${o.order_kind}:${o.order_id}`)}
                                    />
                                ))}
                            </div>
                            <CompletedPaginationBar
                                total={filtered.length}
                                page={currentPage}
                                pageCount={pageCount}
                                pageSize={pageSize}
                                onPrev={() => setPage((value) => Math.max(1, value - 1))}
                                onNext={() => setPage((value) => Math.min(pageCount, value + 1))}
                            />
                        </>
                    )}
                </Card>

                <div className="ct-completed-aside">
                    <Card className="ct-completed-chart-card">
                        <SectionHeader
                            eyebrow="Source path mix"
                            title={`How ${inPeriod.length} order${inPeriod.length === 1 ? "" : "s"} shipped`}
                            icon={<Settings2 size={16} color="var(--text-3)" />}
                        />
                        {sourceDist.length === 0 ? (
                            <EmptyState title="No data" body="Once orders close, source-path mix appears here." />
                        ) : (
                            <div style={{ marginTop: 12 }}>
                                <div className="ct-completed-chart-shell" style={{ height: 160 }}>
                                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={140} initialDimension={{ width: 320, height: 160 }}>
                                        <PieChart>
                                            <Pie data={sourceDist} dataKey="value" nameKey="name" innerRadius={42} outerRadius={68} paddingAngle={2} stroke="var(--surface-1)" strokeWidth={2}>
                                                {sourceDist.map((d) => (<Cell key={d.name} fill={SOURCE_COLORS[d.name] || SOURCE_COLORS.OTHER} />))}
                                            </Pie>
                                            <Tooltip contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-3)", fontSize: 12 }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                                    {sourceDist.map((d) => (
                                        <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                                            <span style={{ width: 10, height: 10, borderRadius: 4, background: SOURCE_COLORS[d.name] }} />
                                            <span style={{ fontWeight: 600 }}>{d.name}</span>
                                            <span style={{ marginLeft: "auto", fontFamily: "var(--f-mono)" }}>{d.value}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Card>

                    <Card>
                        <SectionHeader
                            eyebrow="Top customers"
                            title="By order count"
                            icon={<History size={16} color="var(--text-3)" />}
                        />
                        <TopCustomers orders={inPeriod} />
                    </Card>
                </div>
            </div>
        </div>
    );
}

function pct(value: unknown): string {
    const v = Number(value);
    if (!Number.isFinite(v)) return "—";
    return `${v.toFixed(0)}%`;
}

function CompletedPaginationBar({
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
        <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", background: "var(--surface-1)" }}>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 800, color: "var(--text-3)" }}>
                {start}-{end} of {fmt(total)} closed order lines
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={onPrev}>Prev</Button>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 900, color: "var(--text-2)" }}>
                    Page {page} / {pageCount}
                </span>
                <Button variant="secondary" size="sm" disabled={page >= pageCount} onClick={onNext}>Next</Button>
            </div>
        </div>
    );
}

function CompletedOrderRow({ order, expanded, onToggle }: { order: PlannerControlOrder; expanded: boolean; onToggle: () => void }) {
    const completedAt = getCompletedAt(order);
    const placedAt = getPlacedAt(order);
    const cycle = cycleTimeDays(order);
    const ot = isOnTime(order);
    const path = sourcePath(order);
    const audit = traceAudit(order);
    const factSheet: any = order.order_fact_sheet || {};
    const age = ageInfo(placedAt);
    const ageColor = age ? ageToneColor(age.tone) : null;

    return (
        <div className="ct-completed-row" style={{ borderBottom: "1px solid var(--border-soft)" }}>
            <button
                className="ct-completed-row-button"
                type="button"
                onClick={onToggle}
                style={{
                    width: "100%", textAlign: "left",
                    padding: "14px 20px",
                    background: expanded ? "var(--surface-2)" : "transparent",
                    border: "none", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 10,
                    transition: "background var(--df) var(--eo)",
                }}
            >
                {expanded ? <ChevronDown size={14} color="var(--text-3)" /> : <ChevronRight size={14} color="var(--text-3)" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <OrderPassportStrip order={order} compact showKpis={false} />
                </div>
                <div className="ct-completed-row-meta" style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--text-2)", whiteSpace: "nowrap" }}>
                        {fmt(order.required_qty_kg, 1)} KG{order.required_qty_pcs != null ? ` · ${fmt(order.required_qty_pcs)} pcs` : ""}
                    </span>
                    <span title={audit.message || "Completion audit state"} style={{
                        padding: "2px 8px", fontSize: 10, fontWeight: 800,
                        borderRadius: "var(--r-pill)",
                        background: audit.claimedNoWcm ? "rgba(15,118,110,.12)" : audit.postedWithVariance ? "rgba(245,158,11,.14)" : "rgba(16,185,129,.12)",
                        color: audit.claimedNoWcm ? "#0f766e" : audit.postedWithVariance ? "var(--warning)" : "var(--success)",
                        whiteSpace: "nowrap",
                    }}>
                        {audit.claimedNoWcm ? "STOCK CLAIM" : audit.postedWithVariance ? "SHORT CLOSE" : "WCM POSTED"}
                    </span>
                    {cycle != null && (
                        <span title="Cycle time: placed to production complete" style={{
                            padding: "2px 8px", fontSize: 10, fontWeight: 700,
                            borderRadius: "var(--r-pill)",
                            background: cycle > 14 ? "rgba(245,158,11,.12)" : "rgba(99,102,241,.12)",
                            color: cycle > 14 ? "var(--warning)" : "var(--i-700)",
                            whiteSpace: "nowrap", fontFamily: "var(--f-mono)",
                        }}>
                            {cycle.toFixed(1)}d cycle
                        </span>
                    )}
                    {ot != null && (
                        <span title={ot ? "Completed before/on delivery date" : "Completed after delivery date"} style={{
                            padding: "2px 8px", fontSize: 10, fontWeight: 700,
                            borderRadius: "var(--r-pill)",
                            background: ot ? "rgba(16,185,129,.12)" : "rgba(244,63,94,.12)",
                            color: ot ? "var(--success)" : "var(--danger)",
                            whiteSpace: "nowrap",
                        }}>
                            {ot ? "ON-TIME" : "LATE"}
                        </span>
                    )}
                    <span style={{ padding: "2px 10px", fontSize: 10, fontWeight: 700, borderRadius: "var(--r-pill)", background: SOURCE_COLORS[path] + "22", color: SOURCE_COLORS[path] }}>
                        {path === "CLAIM" ? "CLAIM" : path}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--text-4)", whiteSpace: "nowrap", fontFamily: "var(--f-mono)" }}>
                        {timeAgo(completedAt)}
                    </span>
                </div>
            </button>

            {expanded && (
                <div className="ct-completed-expanded" style={{ padding: "0 20px 20px 42px", background: "var(--surface-1-soft)" }}>
                    {/* Hero row: display_name */}
                    <div style={{ paddingTop: 10, paddingBottom: 14, borderBottom: "1px dashed var(--border-soft)" }}>
                        {factSheet.display_name && (
                            <div style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 700, color: "var(--text-1)", marginBottom: 8 }}>
                                {factSheet.display_name}
                            </div>
                        )}
                        <TraceAuditBanner order={order} />
                        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                            <DetailField label="Customer" value={(order as any).customer_name || "—"} />
                            <DetailField
                                label="Placed"
                                value={placedAt ? `${fmtDateTime(placedAt)}${age ? ` · ${age.label}` : ""}` : "—"}
                                mono
                                accent={ageColor?.fg}
                            />
                            <DetailField label="Closed" value={fmtDateTime(completedAt)} mono />
                            <DetailField label="Cycle time" value={cycle != null ? `${cycle.toFixed(1)} days` : "—"} mono accent={cycle != null && cycle > 14 ? "var(--warning)" : undefined} />
                            <DetailField label="Delivery" value={(order as any).delivery_date ? fmtDateTime((order as any).delivery_date) : "—"} mono />
                            <DetailField label="On-time" value={ot == null ? "—" : ot ? "Yes" : "Late"} accent={ot == null ? undefined : ot ? "var(--success)" : "var(--danger)"} />
                            <DetailField label="Status" value={order.status || "—"} />
                            <DetailField label="Spec hash" value={order.spec_signature ? `${order.spec_signature.slice(0, 12)}…` : "—"} mono />
                        </div>
                    </div>

                    <div style={{ paddingTop: 14, borderBottom: "1px dashed var(--border-soft)", paddingBottom: 14 }}>
                        <PassportDetailGrid order={order} />
                    </div>

                    <div style={{ paddingTop: 14 }}>
                        <ProductionTracePanel order={order} mode="completed" />
                    </div>
                </div>
            )}
        </div>
    );
}

function TraceAuditBanner({ order }: { order: PlannerControlOrder }) {
    const audit = traceAudit(order);
    const trace: any = order.production_trace || {};
    const plannedKg = Number(trace.planned_qty || order.required_qty_kg || 0);
    const postedKg = Number(trace.produced_qty || 0);
    const varianceKg = Number(trace.closure_variance_qty || 0);
    const tone = audit.claimedNoWcm ? {
        bg: "rgba(15,118,110,.08)",
        border: "rgba(15,118,110,.22)",
        fg: "#0f766e",
        title: "Closed by stock / packing claim",
        body: audit.message || "No WCM job rows are attached. Planner should treat this as a closed audit record, not a live production step.",
    } : audit.postedWithVariance ? {
        bg: "rgba(245,158,11,.10)",
        border: "rgba(245,158,11,.25)",
        fg: "var(--warning)",
        title: "Short-close / variance closure",
        body: varianceKg > 0 ? `${fmt(varianceKg, 2)} kg closed as variance after WCM posting.` : "Closed with variance audit state from WCM or planner short close.",
    } : {
        bg: "rgba(16,185,129,.08)",
        border: "rgba(16,185,129,.22)",
        fg: "var(--success)",
        title: "WCM posted closure",
        body: "Production output is backed by WCM job rows; release gates are shown as historical audit only.",
    };
    return (
        <div style={{ padding: "10px 12px", border: `1px solid ${tone.border}`, borderRadius: "var(--r-3)", background: tone.bg, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "center" }}>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 900, color: tone.fg }}>{tone.title}</div>
                <div style={{ marginTop: 2, fontSize: 10, color: "var(--text-3)", lineHeight: 1.35 }}>{tone.body}</div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <MiniAuditStat label="Planned" value={`${fmt(plannedKg, 2)} kg`} />
                <MiniAuditStat label="Posted" value={audit.claimedNoWcm && postedKg <= 0 ? "Claim" : `${fmt(postedKg, 2)} kg`} />
                <MiniAuditStat label="Open" value="Closed" />
            </div>
        </div>
    );
}

function MiniAuditStat({ label, value }: { label: string; value: string }) {
    return (
        <span style={{ minWidth: 76, padding: "5px 7px", border: "1px solid var(--border-soft)", borderRadius: "var(--r-2)", background: "var(--surface-1)" }}>
            <span style={{ display: "block", fontSize: 8, fontWeight: 900, letterSpacing: ".06em", color: "var(--text-4)", textTransform: "uppercase" }}>{label}</span>
            <span style={{ display: "block", marginTop: 1, fontFamily: "var(--f-mono)", fontSize: 10, fontWeight: 900, color: "var(--text-1)" }}>{value}</span>
        </span>
    );
}

function DetailField({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: string }) {
    return (
        <div>
            <div style={{ fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-4)" }}>
                {label}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: accent || "var(--text-1)", marginTop: 2, fontFamily: mono ? "var(--f-mono)" : "var(--f-ui)" }}>
                {value}
            </div>
        </div>
    );
}

function SectionHeader({ eyebrow, title, icon, rightBadge }: { eyebrow: string; title: string; icon?: React.ReactNode; rightBadge?: React.ReactNode }) {
    return (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {icon}
                    <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-3)" }}>
                        {eyebrow}
                    </span>
                </div>
                <div style={{ fontFamily: "var(--f-display)", fontSize: 17, fontWeight: 700, color: "var(--text-1)", marginTop: 4, lineHeight: 1.2 }}>
                    {title}
                </div>
            </div>
            {rightBadge}
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

function TopCustomers({ orders }: { orders: PlannerControlOrder[] }) {
    const counts = useMemo(() => {
        const map: Map<string, { count: number; kg: number }> = new Map();
        for (const o of orders) {
            const c = (o as any).customer_name as string | undefined;
            if (!c) continue;
            const cur = map.get(c) || { count: 0, kg: 0 };
            cur.count++;
            cur.kg += Number(o.required_qty_kg || 0);
            map.set(c, cur);
        }
        return Array.from(map.entries()).map(([name, stats]) => ({ name, ...stats })).sort((a, b) => b.count - a.count).slice(0, 6);
    }, [orders]);

    if (counts.length === 0) return <div style={{ fontSize: 11, color: "var(--text-4)", fontStyle: "italic", marginTop: 12 }}>No customer data in this window.</div>;
    const max = counts[0].count;
    return (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {counts.map((c) => (
                <div key={c.name} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                        <span style={{ fontWeight: 600, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.name}
                        </span>
                        <span style={{ fontFamily: "var(--f-mono)", color: "var(--text-3)" }}>
                            {c.count} · {fmt(c.kg, 0)} KG
                        </span>
                    </div>
                    <div style={{ height: 4, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${(c.count / max) * 100}%`, background: "linear-gradient(90deg, var(--br-500), var(--br-700))" }} />
                    </div>
                </div>
            ))}
        </div>
    );
}

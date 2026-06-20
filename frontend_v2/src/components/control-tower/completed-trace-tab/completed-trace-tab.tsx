"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Clock,
    Download,
    History,
    Package,
    Printer,
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

import { plannerService, type CompletedTraceJob } from "@/services/planner";
import { Card, Hero, Button, EmptyState, Chip } from "@/components/_planner-ui";
import { ageInfo, ageToneColor } from "../_shared/age";
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

function getCompletedAt(o: CompletedTraceJob): string | null {
    return ((o as any).completed_at || (o as any).closed_at || null) as string | null;
}

function getPlacedAt(o: CompletedTraceJob): string | null {
    return ((o as any).created_at || null) as string | null;
}

function cycleTimeDays(o: CompletedTraceJob): number | null {
    const placed = getPlacedAt(o);
    const completed = getCompletedAt(o);
    if (!placed || !completed) return null;
    const p = new Date(placed).getTime();
    const c = new Date(completed).getTime();
    if (Number.isNaN(p) || Number.isNaN(c)) return null;
    return Math.max(0, (c - p) / (1000 * 60 * 60 * 24));
}

function isOnTime(o: CompletedTraceJob): boolean | null {
    const completed = getCompletedAt(o);
    const due = (o as any).delivery_date as string | null | undefined;
    if (!completed || !due) return null;
    const c = new Date(completed).getTime();
    const d = new Date(due).getTime();
    if (Number.isNaN(c) || Number.isNaN(d)) return null;
    return c <= d + 24 * 60 * 60 * 1000; // 1-day grace
}

function traceRowKey(o: CompletedTraceJob): string {
    return String((o as any).job_id || (o as any).id || (o as any).job_number || `${o.order_kind || "job"}:${o.order_id || o.order_number || "unknown"}`);
}

function producedKg(o: CompletedTraceJob): number {
    return Number((o as any).produced_qty ?? o.required_qty_kg ?? 0);
}

type PeriodKey = "24h" | "7d" | "30d" | "90d";
const PERIODS: { key: PeriodKey; label: string; ms: number; days: number }[] = [
    { key: "24h", label: "Today", ms: 24 * 60 * 60 * 1000, days: 1 },
    { key: "7d", label: "7 days", ms: 7 * 24 * 60 * 60 * 1000, days: 7 },
    { key: "30d", label: "30 days", ms: 30 * 24 * 60 * 60 * 1000, days: 30 },
    { key: "90d", label: "90 days", ms: 90 * 24 * 60 * 60 * 1000, days: 90 },
];
const HISTORY_PAGE_SIZE = 40;

const SOURCE_COLORS: Record<string, string> = {
    FG: "#10b981",
    WIP: "#6366f1",
    FRESH: "#2563eb",
    OTHER: "#94a3b8",
};

function exportCsv(rows: CompletedTraceJob[]) {
    const header = ["job_number", "order_number", "template_name", "fg_type", "customer", "produced_qty", "planned_qty", "placed_at", "completed_at", "cycle_days", "on_time", "qty_uom"];
    const lines = [header.join(",")];
    for (const r of rows) {
        const ct = cycleTimeDays(r);
        const ot = isOnTime(r);
        lines.push([
            (r as any).job_number || "",
            r.order_number || "",
            JSON.stringify(r.template_name || ""),
            r.fg_type || r.final_product_type || "",
            JSON.stringify((r as any).customer_name || ""),
            String((r as any).produced_qty ?? r.required_qty_kg ?? ""),
            String((r as any).planned_qty ?? ""),
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
    const [historyOffset, setHistoryOffset] = useState(0);
    const [search, setSearch] = useState("");
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [customerFilter, setCustomerFilter] = useState<string>("all");
    const [sourceFilter, setSourceFilter] = useState<"all" | "FG" | "WIP" | "FRESH">("all");

    const periodCfg = PERIODS.find((p) => p.key === period)!;

    const traceQ = useQuery({
        queryKey: ["planner-completed-job-trace-v1", period, historyOffset],
        queryFn: () => plannerService.getCompletedJobTrace({
            days: periodCfg.days,
            limit: HISTORY_PAGE_SIZE,
            offset: historyOffset,
            timeout_ms: 20000,
        }),
        staleTime: 120_000,
        gcTime: 10 * 60_000,
        retry: 1,
        meta: { suppressGlobalError: true },
    });

    const history = traceQ.data?.results ?? [];
    const traceKpis = traceQ.data?.kpis;
    const historyHasMore = Boolean(traceQ.data?.has_more);
    const nextHistoryOffset = Number(traceQ.data?.next_offset ?? historyOffset + history.length);

    const cutoff = Date.now() - periodCfg.ms;
    const priorCutoff = Date.now() - periodCfg.ms * 2;

    const inPeriod = useMemo(() => {
        return history.filter((o) => {
            const c = getCompletedAt(o);
            if (!c) return true; // include even when completed_at is sparse — backend already filtered by history_days
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
            rows = rows.filter((o) => `${o.order_number} ${o.template_name} ${(o as any).customer_name || ""}`.toLowerCase().includes(q));
        }
        if (customerFilter !== "all") {
            rows = rows.filter((o) => (o as any).customer_name === customerFilter);
        }
        if (sourceFilter !== "all") {
            rows = rows.filter((o) => {
                const fg = !!o.source_availability?.has_fg;
                const wip = !!o.source_availability?.has_wip;
                const path = fg ? "FG" : wip ? "WIP" : "FRESH";
                return path === sourceFilter;
            });
        }
        return rows;
    }, [inPeriod, search, customerFilter, sourceFilter]);

    const distinctCustomers = useMemo(() => {
        const s = new Set<string>();
        inPeriod.forEach((o) => { const c = (o as any).customer_name; if (c) s.add(c); });
        return Array.from(s).sort();
    }, [inPeriod]);

    // ----- KPIs with prior-period deltas -----
    const kpis = useMemo(() => {
        const closedNow = Number(traceKpis?.completed_jobs ?? inPeriod.length);
        const closedPrior = priorPeriod.length;
        const totalKgNow = Number(traceKpis?.produced_qty ?? inPeriod.reduce((s, o) => s + Number((o as any).produced_qty ?? o.required_qty_kg ?? 0), 0));
        const totalKgPrior = priorPeriod.reduce((s, o) => s + Number((o as any).produced_qty ?? o.required_qty_kg ?? 0), 0);
        const customersNow = new Set(inPeriod.map((o) => (o as any).customer_name).filter(Boolean)).size;

        // Cycle time
        const cycles = inPeriod.map(cycleTimeDays).filter((v): v is number => v != null);
        const avgCycle = cycles.length > 0 ? cycles.reduce((a, b) => a + b, 0) / cycles.length : 0;
        const medianCycle = cycles.length > 0 ? [...cycles].sort((a, b) => a - b)[Math.floor(cycles.length / 2)] : 0;

        // On-time
        const onTimeData = inPeriod.map(isOnTime).filter((v): v is boolean => v != null);
        const onTimeCount = onTimeData.filter((v) => v).length;
        const onTimePct = onTimeData.length > 0 ? (onTimeCount / onTimeData.length) * 100 : 0;

        // Variance
        const varianceCount = Number(traceKpis?.variance_jobs ?? inPeriod.filter((o) => (o as any).closed_with_variance).length);

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
            buildKpi("Jobs closed", closedNow, closedPrior, "in selected window"),
            buildKpi("Produced KG", totalKgNow, totalKgPrior, "completed output", 1),
            { eyebrow: "Customers", value: fmt(customersNow), sub: "served in period", accent: "default" as const },
            { eyebrow: "Avg cycle", value: avgCycle > 0 ? `${avgCycle.toFixed(1)}d` : "—", sub: `median ${medianCycle.toFixed(1)}d (placed → closed)`, accent: avgCycle > 14 ? "warn" as const : "info" as const },
            { eyebrow: "On-time", value: onTimeData.length > 0 ? pct(onTimePct) : "—", sub: `${onTimeCount} of ${onTimeData.length} measurable`, accent: onTimePct >= 80 ? "success" as const : onTimePct >= 50 ? "warn" as const : "danger" as const },
            { eyebrow: "Variance", value: fmt(varianceCount), sub: "closed with variance flag", accent: varianceCount > 0 ? "warn" as const : "default" as const },
            { eyebrow: "Avg KG/job", value: fmt(closedNow > 0 ? totalKgNow / closedNow : 0, 1), sub: "in period", accent: "info" as const },
            { eyebrow: "Active now", value: fmt(traceKpis?.in_flight_jobs ?? 0), sub: "still in flight", accent: "info" as const },
        ];
    }, [inPeriod, priorPeriod, traceKpis]);

    // ----- Source path mix -----
    const sourceDist = useMemo(() => {
        const counts: Record<string, number> = { FG: 0, WIP: 0, FRESH: 0 };
        for (const o of inPeriod) {
            const fg = !!o.source_availability?.has_fg;
            const wip = !!o.source_availability?.has_wip;
            if (fg) counts.FG++;
            else if (wip) counts.WIP++;
            else counts.FRESH++;
        }
        return Object.entries(counts).filter(([_, v]) => v > 0).map(([name, value]) => ({ name, value }));
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
            e.kg += producedKg(o);
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
            e.kg += producedKg(o);
        }
        return Array.from(map.values()).sort((a, b) => b.kg - a.kg).slice(0, 6);
    }, [inPeriod]);

    const toggleExpand = (key: string) => setExpanded((s) => ({ ...s, [key]: !s[key] }));

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Hero
                eyebrow="Planner Command Tower · Tab 4"
                title="Completed Trace"
                subtitle="Completed production jobs with cycle time, output KG, route proof, and variance trace."
                actions={
                    <div style={{ display: "flex", gap: 6 }}>
                        <Button variant="secondary" onClick={() => exportCsv(filtered)}>
                            <Download size={14} style={{ marginRight: 6 }} />
                            Export CSV
                        </Button>
                        <Button variant="ghost" onClick={() => traceQ.refetch()}>
                            <RefreshCw size={14} className={traceQ.isFetching ? "spin" : ""} style={{ marginRight: 6 }} />
                            Refresh
                        </Button>
                    </div>
                }
                kpis={kpis as any}
            />

            {/* Period selector + filters */}
            <Card>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", gap: 4 }}>
                        {PERIODS.map((p) => (
                            <button
                                key={p.key}
                                type="button"
                                onClick={() => {
                                    setPeriod(p.key);
                                    setHistoryOffset(0);
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
                            onChange={(e) => setCustomerFilter(e.target.value)}
                            style={{ padding: "7px 10px", fontSize: 12, fontFamily: "var(--f-ui)", background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-2)", outline: "none" }}
                        >
                            <option value="all">All customers ({distinctCustomers.length})</option>
                            {distinctCustomers.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <div style={{ display: "flex", gap: 3 }}>
                            {(["all", "FG", "WIP", "FRESH"] as const).map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => setSourceFilter(s)}
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
                                    {s === "all" ? "All" : s}
                                </button>
                            ))}
                        </div>
                        <div style={{ position: "relative", minWidth: 240 }}>
                            <Search size={12} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-4)" }} />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search order, template, customer"
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
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(0, 1fr)", gap: 18 }}>
                <Card className="is-emphasis">
                    <SectionHeader
                        eyebrow="Throughput"
                        title="Jobs closed per day"
                        icon={<TrendingUp size={16} color="var(--br-700)" />}
                        rightBadge={<BigNumber value={fmt(throughput.reduce((s, t) => s + t.kg, 0), 0)} suffix="KG total" />}
                    />
                    {throughput.length === 0 ? (
                        <EmptyState title="No throughput data" body="Once orders close in the selected period, daily throughput appears here." />
                    ) : (
                        <div style={{ height: 220, marginTop: 14 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={throughput} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text-4)" }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 10, fill: "var(--text-4)" }} axisLine={false} tickLine={false} />
                                    <Tooltip contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-3)", fontSize: 12 }} />
                                    <Bar dataKey="orders" name="Jobs" fill="#2563eb" radius={[3, 3, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </Card>

                <Card>
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

            {/* Completed jobs + source mix */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 18 }}>
                <Card style={{ padding: 0 }}>
                    <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                            <div className="t-eyebrow">Completed jobs</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                                {traceKpis?.completed_jobs ?? filtered.length} job{(traceKpis?.completed_jobs ?? filtered.length) === 1 ? "" : "s"} in {periodCfg.label}
                            </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                            <span style={{ fontSize: 10, fontFamily: "var(--f-mono)", fontWeight: 700, color: "var(--text-3)" }}>
                                {history.length > 0
                                    ? `${historyOffset + 1}-${historyOffset + history.length}`
                                    : "0"} shown
                            </span>
                            <Button
                                variant="secondary"
                                onClick={() => setHistoryOffset(Math.max(0, historyOffset - HISTORY_PAGE_SIZE))}
                                disabled={historyOffset === 0 || traceQ.isFetching}
                                style={{ padding: "6px 10px", fontSize: 11 }}
                            >
                                Prev
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => setHistoryOffset(nextHistoryOffset)}
                                disabled={!historyHasMore || traceQ.isFetching}
                                style={{ padding: "6px 10px", fontSize: 11 }}
                            >
                                Next
                            </Button>
                            <History size={16} color="var(--text-3)" />
                        </div>
                    </div>
                    {traceQ.isError ? (
                        <EmptyState
                            title="Trace history did not load"
                            body="The page kept the rest of Control Tower usable. Retry this smaller history page."
                            cta={<Button variant="secondary" onClick={() => traceQ.refetch()}>Retry</Button>}
                        />
                    ) : filtered.length === 0 ? (
                        <EmptyState title="No completed jobs" body="Try a longer lookback window or clear the search/filters." />
                    ) : (
                        <div style={{ maxHeight: 800, overflowY: "auto" }}>
                            {filtered.map((o) => (
                                <CompletedOrderRow
                                    key={traceRowKey(o)}
                                    order={o}
                                    expanded={!!expanded[traceRowKey(o)]}
                                    onToggle={() => toggleExpand(traceRowKey(o))}
                                />
                            ))}
                        </div>
                    )}
                </Card>

                <div style={{ display: "flex", flexDirection: "column", gap: 14, position: "sticky", top: 12, alignSelf: "start" }}>
                    <Card>
                        <SectionHeader
                            eyebrow="Source path mix"
                            title={`How ${traceKpis?.completed_jobs ?? inPeriod.length} job${(traceKpis?.completed_jobs ?? inPeriod.length) === 1 ? "" : "s"} completed`}
                            icon={<Settings2 size={16} color="var(--text-3)" />}
                        />
                        {sourceDist.length === 0 ? (
                            <EmptyState title="No data" body="Once orders close, source-path mix appears here." />
                        ) : (
                            <div style={{ marginTop: 12 }}>
                                <div style={{ height: 160 }}>
                                    <ResponsiveContainer width="100%" height="100%">
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
                            title="By completed job count"
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

function CompletedOrderRow({ order, expanded, onToggle }: { order: CompletedTraceJob; expanded: boolean; onToggle: () => void }) {
    const fgType = String(order.fg_type || order.final_product_type || "—");
    const completedAt = getCompletedAt(order);
    const placedAt = getPlacedAt(order);
    const cycle = cycleTimeDays(order);
    const ot = isOnTime(order);
    const fg = !!order.source_availability?.has_fg;
    const wip = !!order.source_availability?.has_wip;
    const sourcePath = fg ? "FG" : wip ? "WIP" : "FRESH";
    const factSheet: any = order.order_fact_sheet || {};
    const layers: string[] = Array.isArray(order.display_layers)
        ? (order.display_layers as string[])
        : Array.isArray(order.layer_snapshot)
        ? order.layer_snapshot.map((l: any) => `${l.name || "Layer"}${l.thickness_micron ? ` · ${l.thickness_micron}μ` : ""}`)
        : [];
    const templateSteps: any[] = Array.isArray(order.template_steps) ? order.template_steps : [];
    const materialPlan: any[] = Array.isArray(order.material_plan_lines) ? order.material_plan_lines : [];
    const completedJobs: any[] = Array.isArray((order as any).completed_jobs) ? (order as any).completed_jobs : [];
    const jobNumbers: string[] = Array.isArray((order as any).job_numbers) ? (order as any).job_numbers : [];
    const age = ageInfo(placedAt);
    const ageColor = age ? ageToneColor(age.tone) : null;

    return (
        <div style={{ borderBottom: "1px solid var(--border-soft)" }}>
            <button
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
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 700, color: "var(--text-1)" }}>
                    {(order as any).job_number || order.order_number}
                </span>
                <Chip kind={fgType.toLowerCase().includes("roll") ? "fg-roll" : "fg-pouch"}>{fgType}</Chip>
                <span style={{ flex: 1, fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {order.order_number ? `${order.order_number} · ` : ""}{factSheet.display_name || order.template_name} · {(order as any).customer_name || "—"}
                </span>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--text-2)", whiteSpace: "nowrap" }}>
                    {fmt(producedKg(order), 1)} {order.qty_uom || (order as any).uom || "KG"}
                </span>
                {cycle != null && (
                    <span title="Cycle time: placed → closed" style={{
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
                    <span title={ot ? "Closed before/on delivery date" : "Closed after delivery date"} style={{
                        padding: "2px 8px", fontSize: 10, fontWeight: 700,
                        borderRadius: "var(--r-pill)",
                        background: ot ? "rgba(16,185,129,.12)" : "rgba(244,63,94,.12)",
                        color: ot ? "var(--success)" : "var(--danger)",
                        whiteSpace: "nowrap",
                    }}>
                        {ot ? "ON-TIME" : "LATE"}
                    </span>
                )}
                <span style={{ padding: "2px 10px", fontSize: 10, fontWeight: 700, borderRadius: "var(--r-pill)", background: SOURCE_COLORS[sourcePath] + "22", color: SOURCE_COLORS[sourcePath] }}>
                    {sourcePath}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-4)", whiteSpace: "nowrap", fontFamily: "var(--f-mono)" }}>
                    {timeAgo(completedAt)}
                </span>
            </button>

            {expanded && (
                <div style={{ padding: "0 20px 20px 42px", background: "var(--surface-1-soft)" }}>
                    {/* Hero row: display_name */}
                    <div style={{ paddingTop: 10, paddingBottom: 14, borderBottom: "1px dashed var(--border-soft)" }}>
                        {factSheet.display_name && (
                            <div style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 700, color: "var(--text-1)", marginBottom: 8 }}>
                                {factSheet.display_name}
                            </div>
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
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

                    {/* Geometry + layers + printing + packaging */}
                    <div style={{ paddingTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                        <div>
                            <SectionLabel icon={<Settings2 size={12} />}>Geometry</SectionLabel>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginTop: 4 }}>
                                {factSheet.profile_label || order.display_geometry_label || `${fmt(order.effective_dims?.width_mm)}×${fmt(order.effective_dims?.height_mm)} mm`}
                            </div>
                        </div>
                        {layers.length > 0 && (
                            <div>
                                <SectionLabel icon={<Package size={12} />}>Layers ({layers.length})</SectionLabel>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                                    {layers.map((l, i) => (
                                        <div key={i} style={{ fontSize: 11, color: "var(--text-2)", fontFamily: "var(--f-mono)", padding: "4px 8px", background: "var(--surface-1)", borderRadius: "var(--r-2)", borderLeft: "2px solid var(--br-400)" }}>
                                            {l}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        {factSheet.print_profile_label && Number(factSheet.front_colors_count || 0) > 0 && (
                            <div>
                                <SectionLabel icon={<Printer size={12} />}>Printing</SectionLabel>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginTop: 4 }}>
                                    {factSheet.print_profile_label}
                                </div>
                            </div>
                        )}
                        {(order.display_packaging_label as string | undefined) && (
                            <div>
                                <SectionLabel icon={<Package size={12} />}>Packaging</SectionLabel>
                                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", marginTop: 4 }}>
                                    {String(order.display_packaging_label)}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Route */}
                    {templateSteps.length > 0 && (
                        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--border-soft)" }}>
                            <SectionLabel>Production route</SectionLabel>
                            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                                {templateSteps.map((step: any, i: number) => (
                                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                        <span style={{
                                            padding: "6px 12px",
                                            background: "rgba(16,185,129,.10)",
                                            color: "var(--e-700)",
                                            border: "1px solid rgba(16,185,129,.24)",
                                            borderRadius: "var(--r-2)",
                                            fontSize: 11, fontWeight: 600,
                                        }}>
                                            <span style={{ fontFamily: "var(--f-mono)", fontSize: 9, marginRight: 4, color: "var(--e-700)" }}>{step.sequence_number}</span>
                                            {step.process_name || step.step_name || step.process_code}
                                        </span>
                                        {i < templateSteps.length - 1 && <ChevronRight size={11} color="var(--text-4)" />}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Jobs + Material plan two-column */}
                    {((completedJobs.length > 0 || jobNumbers.length > 0) || materialPlan.length > 0) && (
                        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--border-soft)", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 14 }}>
                            {(completedJobs.length > 0 || jobNumbers.length > 0) && (
                                <div>
                                    <SectionLabel>Jobs ({completedJobs.length || jobNumbers.length})</SectionLabel>
                                    <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                                        {(completedJobs.length > 0 ? completedJobs : jobNumbers).map((j: any, i: number) => (
                                            <span key={i} style={{ fontFamily: "var(--f-mono)", fontSize: 10, padding: "3px 8px", background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-2)", color: "var(--text-2)" }}>
                                                {typeof j === "string" ? j : (j.job_number || j.id)}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {materialPlan.length > 0 && (
                                <div>
                                    <SectionLabel>Material plan ({materialPlan.length} lines)</SectionLabel>
                                    <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                                        {materialPlan.slice(0, 8).map((m: any, i: number) => (
                                            <div key={i} style={{
                                                padding: "5px 9px",
                                                background: "var(--surface-1)",
                                                borderRadius: "var(--r-2)",
                                                fontSize: 10,
                                                display: "flex",
                                                justifyContent: "space-between",
                                                gap: 6,
                                            }}>
                                                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-2)" }}>
                                                    {m.material_name}
                                                </span>
                                                <span style={{ fontFamily: "var(--f-mono)", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                                                    {fmt(m.planned_issue_qty, 2)} {m.uom}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
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

function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text-3)" }}>
            {icon && <span style={{ color: "var(--text-3)" }}>{icon}</span>}
            <span>{children}</span>
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

function TopCustomers({ orders }: { orders: CompletedTraceJob[] }) {
    const counts = useMemo(() => {
        const map: Map<string, { count: number; kg: number }> = new Map();
        for (const o of orders) {
            const c = (o as any).customer_name as string | undefined;
            if (!c) continue;
            const cur = map.get(c) || { count: 0, kg: 0 };
            cur.count++;
            cur.kg += producedKg(o);
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

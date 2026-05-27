"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { analyticsApi } from "@/services/analytics";
import {
    Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
    ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import {
    AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2,
    Droplets, Factory, IndianRupee, Package, RefreshCw, Shield,
    TrendingUp, Users, Zap, Activity, BarChart3, Clock, Layers,
    Truck, FileText, Flame, AlertCircle, Cpu, Repeat, Award,
    ShoppingCart,
} from "lucide-react";
import styles from "./owner.module.css";

/* ─────────────── Helpers ─────────────── */
function fmt(v: unknown, decimals = 1): string {
    if (v === null || v === undefined) return "—";
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (isNaN(n)) return "—";
    return n.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}
function fmtCurr(v: number): string {
    if (isNaN(v)) return "₹0";
    if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(2)} Cr`;
    if (v >= 100_000) return `₹${(v / 100_000).toFixed(1)} L`;
    if (v >= 1_000) return `₹${(v / 1_000).toFixed(1)}K`;
    return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
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
function KPICard({ label, value, sub, trend, icon, gradientClass, suffix = "", delay = "0ms", currency = false }: {
    label: string; value: number; sub?: string; trend?: number;
    icon: React.ReactNode; gradientClass: string;
    suffix?: string; delay?: string; currency?: boolean;
}) {
    return (
        <div className={styles.kpiCard} style={{ animationDelay: delay }}>
            <div className={`${styles.kpiIconWrap} ${gradientClass}`}>{icon}</div>
            <div className={styles.kpiContent}>
                <div className={styles.kpiLabel}>{label}</div>
                <div className={styles.kpiValue}>
                    {currency ? fmtCurr(value) : <><AnimCount value={value} decimals={1} />{suffix}</>}
                </div>
                {sub && <div className={styles.kpiSub}>{sub}</div>}
                {trend !== undefined && (
                    <div className={`${styles.kpiTrend} ${trend >= 0 ? styles.trendUp : styles.trendDown}`}>
                        {trend >= 0 ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                        <span>{Math.abs(trend).toFixed(1)}%</span>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ─────────────── Health Bar ─────────────── */
function HealthBar({ label, value, max = 100, fillClass, suffix = "%" }: { label: string; value: number; max?: number; fillClass: string; suffix?: string }) {
    return (
        <div className={styles.healthBarWrap}>
            <div className={styles.healthBarHeader}>
                <span className={styles.healthBarLabel}>{label}</span>
                <span className={styles.healthBarValue}>{fmt(value, 1)}{suffix}</span>
            </div>
            <div className={styles.healthBarTrack}>
                <div className={`${styles.healthBarFill} ${fillClass}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
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
    RUNNING: "#2563eb", COMPLETED: "#10b981", PAUSED: "#06b6d4",
    PENDING: "#78716c", CANCELLED: "#f43f5e", DRAFT: "#f59e0b",
    RELEASED: "#60a5fa", EXECUTING: "#38bdf8", PLANNED: "#10b981",
};
const INV_COLORS = ["#2563eb", "#06b6d4", "#10b981"];

/* ─────────────── MAIN PAGE ─────────────── */
export default function OwnerDashboardPage() {
    const [timeframe, setTimeframe] = useState("month");
    const [countdown, setCountdown] = useState(30);
    const [showHeavyBands, setShowHeavyBands] = useState(false);

    const query = useQuery({
        queryKey: ["owner-control-tower", timeframe],
        queryFn: () => analyticsApi.getControlTowerStats(timeframe),
        refetchInterval: 60_000,
        staleTime: 300_000,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
        placeholderData: (previous) => previous,
    });

    useEffect(() => {
        setCountdown(30);
        const iv = setInterval(() => setCountdown(c => (c <= 1 ? 30 : c - 1)), 1000);
        return () => clearInterval(iv);
    }, [query.dataUpdatedAt, timeframe]);

    useEffect(() => {
        setShowHeavyBands(false);
        const handle = window.setTimeout(() => setShowHeavyBands(true), 220);
        return () => window.clearTimeout(handle);
    }, [timeframe]);

    const data = query.data ?? ({} as any);
    const metrics: any[] = data.metrics ?? [];
    const gm = (id: string) => metrics.find((m: any) => m.id === id) ?? {};

    const revenue = gm("revenue");
    const profit = gm("net_profit");
    const production = gm("production");
    const inventory = gm("inventory");
    const utilization = gm("machine_utilization");
    const scrap = gm("scrap_mtd");

    const finSum: any = data.financial_summary ?? {};
    const finTrend: any[] = data.financial_trend ?? [];
    const material: any = data.material_control ?? {};
    const ink: any = data.ink_control ?? {};
    const shiftRows: any[] = data.shift_oee ?? [];
    const risks: any[] = data.risk_signals ?? [];
    const jobDist: any[] = data.job_distribution ?? [];
    const topCustomers: any[] = data.top_customers ?? [];
    const skuPerf: any[] = data.sku_performance ?? [];
    const activeJobs: any[] = data.active_jobs ?? [];
    const alerts: any[] = data.alerts ?? [];
    const invDist: any[] = data.inventory_distribution ?? [];
    const routeReuse: any = data.route_reuse_mix ?? {};
    const podKpis: any = data.pod_kpis ?? {};
    const trading: any = data.trading ?? {};
    const tradingSeries: any[] = (trading.trade_revenue_series ?? []).map((r: any) => ({
        date: String(r.date ?? "").slice(5),
        revenue_inr: Number(r.revenue_inr || 0),
    }));

    const procurement: any = data.procurement ?? {};
    const topVendors: any[] = procurement.top_vendors ?? [];

    const scrapTrend = useMemo(() =>
        (data.scrap_trend ?? []).map((r: any) => ({
            date: String(r.date ?? "").slice(5), value: Number(r.count || 0),
        })), [data.scrap_trend]);

    const productionTrend = useMemo(() =>
        (data.production_trend ?? []).map((r: any) => ({
            date: String(r.date ?? "").slice(5), value: Number(r.count || 0),
        })), [data.production_trend]);

    const salesTrend = useMemo(() =>
        (data.sales_trend ?? []).map((r: any) => ({
            date: String(r.date ?? "").slice(5), weight: Number(r.weight || 0),
        })), [data.sales_trend]);

    const utilizationVal = parseFloat(String(utilization.value || 0));
    const disciplineVal = parseFloat(String(material.issue_discipline_pct || 0));
    const varianceVal = parseFloat(String(material.variance_pct || 0));
    const returnVal = parseFloat(String(material.return_efficiency_pct || 0));
    const grossMarginPct = parseFloat(String(finSum.gross_margin_pct || 0));
    const netMarginPct = parseFloat(String(finSum.net_margin_pct || 0));
    const grossProfit = parseFloat(String(finSum.gross_profit || 0));
    const totalCogs = parseFloat(String(finSum.total_cogs || 0));
    const totalOverheads = parseFloat(String(finSum.overheads?.total_overheads || 0));
    const scrapVal = parseFloat(String(scrap.value || 0));
    const productionVal = parseFloat(String(production.value || 0));
    const scrapRatePct = productionVal > 0 ? (scrapVal / (productionVal + scrapVal)) * 100 : 0;

    const totalOut = shiftRows.reduce((s: number, r: any) => s + (r.output_kg || 0), 0);
    const totalScrapKg = shiftRows.reduce((s: number, r: any) => s + (r.scrap_kg || 0), 0);
    const fpyPct = (totalOut + totalScrapKg) > 0 ? (totalOut / (totalOut + totalScrapKg)) * 100 : 0;

    const jobTotal = jobDist.reduce((acc: number, d: any) => acc + (d.count ?? 0), 0);
    const maxFinTrend = Math.max(...finTrend.map((r: any) => r.revenue || 0), 1);

    const dispatchAlerts = alerts.filter((a: any) => a.type === "dispatch");
    const overdueAlerts = alerts.filter((a: any) => a.type === "overdue");
    const draftAlerts = alerts.filter((a: any) => a.type === "draft");
    const dispatchCount = dispatchAlerts.reduce((s: number, a: any) => s + (a.count || 0), 0);
    const overdueCount = overdueAlerts.reduce((s: number, a: any) => s + (a.count || 0), 0);
    const draftCount = draftAlerts.reduce((s: number, a: any) => s + (a.count || 0), 0);

    const isRefreshing = query.isFetching && Boolean(query.data);

    return (
        <div className={styles.ownerDash}>

            {/* ─── HERO HEADER ─── */}
            <div className={styles.heroCard}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 14 }}>
                    <div>
                        <h1 className={styles.heroTitle}>🏭 Owner Command Deck</h1>
                        <p className={styles.heroSubtitle}>
                            Financials · Production · Quality · Inventory · Risk — real-time factory intelligence
                        </p>
                    </div>
                    <div className={styles.heroControls}>
                        <div className={styles.countdownBadge}>
                            <span className={styles.liveDot} />
                            LIVE · {countdown}s {isRefreshing ? "· syncing" : ""}
                        </div>
                        <div className={styles.timeframeTabs}>
                            {(["day", "week", "month", "year"] as const).map(tf => (
                                <button key={tf}
                                    className={`${styles.tfBtn} ${timeframe === tf ? styles.tfBtnActive : ""}`}
                                    onClick={() => setTimeframe(tf)}
                                >
                                    {tf.charAt(0).toUpperCase() + tf.slice(1)}
                                </button>
                            ))}
                        </div>
                        <button className={styles.refreshBtn} onClick={() => query.refetch()}>
                            <RefreshCw size={12} className={query.isFetching ? styles.spin : ""} /> Refresh
                        </button>
                    </div>
                </div>
            </div>

            {/* ─── ROW 1: 8 PRIMARY KPI CARDS (4×2) ─── */}
            <div className={styles.kpiGrid}>
                <KPICard label="Gross Revenue" value={parseFloat(String(revenue.value || 0))} icon={<IndianRupee size={17} color="#fff" />} gradientClass={styles.gIndigo} currency delay="0ms" />
                <KPICard label="Net Profit" value={parseFloat(String(profit.value || 0))} icon={<TrendingUp size={17} color="#fff" />} gradientClass={styles.gViolet} currency delay="40ms" />
                <KPICard label="Gross Margin" value={grossMarginPct} icon={<BarChart3 size={17} color="#fff" />} gradientClass={styles.gEmerald} suffix="%" delay="80ms" />
                <KPICard label="Net Margin" value={netMarginPct} icon={<Activity size={17} color="#fff" />} gradientClass={styles.gCyan} suffix="%" delay="120ms" />
                <KPICard label="Production" value={productionVal} icon={<Factory size={17} color="#fff" />} gradientClass={styles.gOrange} suffix=" KG" delay="160ms" />
                <KPICard label="Utilization" value={utilizationVal} icon={<Cpu size={17} color="#fff" />} gradientClass={styles.gSky} suffix="%" delay="200ms" sub={String(utilization.sub_value || "")} />
                <KPICard label="First Pass Yield" value={fpyPct} icon={<CheckCircle2 size={17} color="#fff" />} gradientClass={styles.gEmerald} suffix="%" delay="240ms" sub="Quality Rate" />
                <KPICard label="Scrap Rate" value={scrapRatePct} icon={<Flame size={17} color="#fff" />} gradientClass={styles.gRose} suffix="%" delay="280ms" sub={`${fmt(scrapVal)} KG wasted`} />
            </div>

            {/* ─── ROW 2: OPERATIONAL STATUS STRIP ─── */}
            <div className={`${styles.quadGrid} ${styles.animUp}`} style={{ animationDelay: "100ms" }}>
                <div className={`${styles.statusCard} ${styles.statusTeal}`}>
                    <div className={styles.statusLabel}>Dispatch Ready</div>
                    <div className={styles.statusVal}>{dispatchCount}</div>
                    <div className={styles.statusSub}>orders awaiting dispatch</div>
                </div>
                <div className={`${styles.statusCard} ${styles.statusRose}`}>
                    <div className={styles.statusLabel}>Overdue Orders</div>
                    <div className={styles.statusVal}>{overdueCount}</div>
                    <div className={styles.statusSub}>past delivery date</div>
                </div>
                <div className={`${styles.statusCard} ${styles.statusAmber}`}>
                    <div className={styles.statusLabel}>Draft Orders</div>
                    <div className={styles.statusVal}>{draftCount}</div>
                    <div className={styles.statusSub}>awaiting confirmation</div>
                </div>
                <div className={`${styles.statusCard} ${styles.statusIndigo}`}>
                    <div className={styles.statusLabel}>Inventory Asset</div>
                    <div className={styles.statusVal} style={{ fontSize: 18 }}>{fmtCurr(parseFloat(String(inventory.value || 0)))}</div>
                    <div className={styles.statusSub}>estimated value</div>
                </div>
            </div>

            {/* ─── ROW 3: P&L BREAKDOWN ─── */}
            <div className={`${styles.glassCard} ${styles.animUp}`} style={{ marginBottom: 14, animationDelay: "120ms" }}>
                <div className={styles.sectionTitle}><IndianRupee size={13} /> P&amp;L Breakdown</div>
                <div className={styles.quadGrid} style={{ marginBottom: 0 }}>
                    <div className={styles.finBreakCard}><div className={styles.finBreakLabel}>Revenue</div><div className={styles.finBreakVal} style={{ color: "#a5b4fc" }}>{fmtCurr(parseFloat(String(finSum.revenue || 0)))}</div><div className={styles.finBreakSub}>Total billings</div></div>
                    <div className={styles.finBreakCard}><div className={styles.finBreakLabel}>COGS</div><div className={styles.finBreakVal} style={{ color: "#f87171" }}>{fmtCurr(totalCogs)}</div><div className={styles.finBreakSub}>Materials + conversion</div></div>
                    <div className={styles.finBreakCard}><div className={styles.finBreakLabel}>Gross Profit</div><div className={styles.finBreakVal} style={{ color: "#34d399" }}>{fmtCurr(grossProfit)}</div><div className={styles.finBreakSub}>{fmt(grossMarginPct)}% margin</div></div>
                    <div className={styles.finBreakCard}><div className={styles.finBreakLabel}>Overheads</div><div className={styles.finBreakVal} style={{ color: "#bfdbfe" }}>{fmtCurr(totalOverheads)}</div><div className={styles.finBreakSub}>Elec + Labor + Other</div></div>
                </div>
                {finSum.overheads && (
                    <>
                        <hr className={styles.divider} />
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                            <div className={styles.overheadChip}><div className={styles.overheadLabel}>⚡ Electricity</div><div className={styles.overheadVal}>{fmtCurr(parseFloat(String(finSum.overheads.electricity || 0)))}</div></div>
                            <div className={styles.overheadChip}><div className={styles.overheadLabel}>👷 Labour</div><div className={styles.overheadVal}>{fmtCurr(parseFloat(String(finSum.overheads.labor || 0)))}</div></div>
                            <div className={styles.overheadChip}><div className={styles.overheadLabel}>📦 Other</div><div className={styles.overheadVal}>{fmtCurr(parseFloat(String(finSum.overheads.other || 0)))}</div></div>
                        </div>
                    </>
                )}
            </div>

            {/* ─── TRADING PULSE ─── */}
            <div className={`${styles.glassCard} ${styles.animUp}`} style={{ marginBottom: 14, animationDelay: "130ms" }}>
                <div className={styles.tradingHeader}>
                    <div className={styles.sectionTitle}><Repeat size={13} /> Trading Pulse</div>
                    <Link href="/analytics/reports/trading" className={styles.tradingLink}>View full report →</Link>
                </div>
                <div className={styles.kpiGrid} style={{ marginTop: 6 }}>
                    <KPICard
                        label="Trading Stock Value"
                        value={Number(trading.trading_stock_value_inr || 0)}
                        icon={<IndianRupee size={17} color="#fff" />}
                        gradientClass={styles.gradEmerald}
                        currency
                        delay="0ms"
                    />
                    <KPICard
                        label="Open Trade Orders"
                        value={Number(trading.open_trade_orders || 0)}
                        icon={<Repeat size={17} color="#fff" />}
                        gradientClass={styles.gradTeal}
                        delay="40ms"
                    />
                    <KPICard
                        label="Trade Revenue (MTD)"
                        value={Number(trading.trade_revenue_mtd_inr || 0)}
                        trend={Number(trading.trade_revenue_delta_pct || 0)}
                        icon={<TrendingUp size={17} color="#fff" />}
                        gradientClass={styles.gradCyan}
                        currency
                        delay="80ms"
                    />
                    <KPICard
                        label="Trade Margin %"
                        value={Number(trading.trade_margin_pct || 0)}
                        suffix="%"
                        icon={<Award size={17} color="#fff" />}
                        gradientClass={styles.gradIndigo}
                        delay="120ms"
                    />
                </div>
                {tradingSeries.length > 0 && (
                    <div className={styles.trendCard}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>Last 14 days trade revenue</div>
                        <ResponsiveContainer width="100%" height={140} minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
                            <AreaChart data={tradingSeries} margin={{ top: 5, right: 8, left: -25, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="tradeGrad" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.55} />
                                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.08)" />
                                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtCurr(Number(v))} />
                                <Tooltip formatter={(v: any) => fmtCurr(Number(v))} />
                                <Area type="monotone" dataKey="revenue_inr" name="Revenue" stroke="#10b981" strokeWidth={2} fill="url(#tradeGrad)" dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                )}
                {trading.top_trading_good && (
                    <div className={styles.tradingHighlight}>
                        <span>Top trading good · {trading.top_trading_good.name}</span>
                        <strong>{fmtCurr(Number(trading.top_trading_good.revenue_inr || 0))}</strong>
                    </div>
                )}
            </div>

            {/* ─── PROCUREMENT PULSE ─── */}
            <div className={`${styles.glassCard} ${styles.animUp}`} style={{ marginBottom: 14, animationDelay: "140ms" }}>
                <div className={styles.tradingHeader}>
                    <div className={styles.sectionTitle}><ShoppingCart size={13} /> Procurement Pulse</div>
                    <Link href="/procurement/purchase-orders" className={styles.procurementLink}>View purchase orders →</Link>
                </div>
                <div className={styles.kpiGrid} style={{ marginTop: 6 }}>
                    <KPICard
                        label="Open POs"
                        value={Number(procurement.open_pos_count || 0)}
                        sub={fmtCurr(Number(procurement.open_po_value_inr || 0)) + " in flight"}
                        icon={<FileText size={17} color="#fff" />}
                        gradientClass={styles.gradNavy}
                        delay="0ms"
                    />
                    <KPICard
                        label="Overdue POs"
                        value={Number(procurement.overdue_pos_count || 0)}
                        sub="Past expected delivery"
                        icon={<AlertTriangle size={17} color="#fff" />}
                        gradientClass={styles.gradAmber}
                        delay="40ms"
                    />
                    <KPICard
                        label="MTD Spend"
                        value={Number(procurement.mtd_spend_inr || 0)}
                        sub="Completed POs this month"
                        icon={<IndianRupee size={17} color="#fff" />}
                        gradientClass={styles.gradBlue}
                        currency
                        delay="80ms"
                    />
                    <KPICard
                        label="Avg cycle days"
                        value={Number(procurement.avg_cycle_days || 0)}
                        sub="Order → completion (30d)"
                        icon={<Clock size={17} color="#fff" />}
                        gradientClass={styles.gradSlate}
                        delay="120ms"
                    />
                </div>
                <div className={styles.procurementVendorList}>
                    <div className={styles.procurementVendorTitle}>Top vendors this month by spend</div>
                    {topVendors.length === 0 ? (
                        <div className={styles.procurementEmptyVendors}>No vendor spend recorded yet this month.</div>
                    ) : (
                        topVendors.map((v: any, i: number) => (
                            <div key={v.vendor_id ?? `v-${i}`} className={styles.procurementVendorRow}>
                                <div className={styles.procurementVendorRank}>{i + 1}</div>
                                <div className={styles.procurementVendorName}>{v.vendor_name || "—"}</div>
                                <div className={styles.procurementVendorTotal}>{fmtCurr(Number(v.total_inr || 0))}</div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {!showHeavyBands ? (
                <div className={`${styles.glassCard} ${styles.animUp}`} style={{ marginBottom: 14, animationDelay: "150ms" }}>
                    <div className={styles.sectionTitle}><RefreshCw size={13} className={query.isFetching ? styles.spin : ""} /> Loading lower analytics bands</div>
                    <div className={styles.emptyState} style={{ minHeight: 120 }}>
                        Executive summary stays visible immediately while deeper charts, mix views, and heavy trend bands mount in the background.
                    </div>
                </div>
            ) : (
            <>
            {/* ─── ROW 4: REVENUE TREND + INVENTORY MIX ─── */}
            <div className={`${styles.chartsGrid} ${styles.animUp}`} style={{ animationDelay: "150ms" }}>
                {/* Revenue Trend */}
                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><TrendingUp size={13} /> Revenue &amp; Profit Trend</div>
                    <div style={{ height: 200 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
                            <AreaChart data={finTrend.length > 0 ? finTrend : productionTrend} margin={{ top: 5, right: 8, left: -15, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="revG" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0.03} />
                                    </linearGradient>
                                    <linearGradient id="profG" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.03} />
                                    </linearGradient>
                                    <linearGradient id="prodG" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0.03} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.1)" />
                                <XAxis dataKey={finTrend.length > 0 ? "period" : "date"} tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} tickFormatter={(v) => v >= 100000 ? `${(v / 100000).toFixed(0)}L` : String(v)} />
                                <Tooltip content={<ChartTooltip />} />
                                {finTrend.length > 0 ? (
                                    <>
                                        <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#2563eb" strokeWidth={2} fill="url(#revG)" dot={false} />
                                        <Area type="monotone" dataKey="net_profit" name="Net Profit" stroke="#10b981" strokeWidth={2} fill="url(#profG)" dot={false} />
                                        <Legend wrapperStyle={{ fontSize: 10, color: "#64748b" }} />
                                    </>
                                ) : (
                                    <Area type="monotone" dataKey="value" name="Output KG" stroke="#2563eb" strokeWidth={2} fill="url(#prodG)" dot={false} />
                                )}
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    {/* Monthly bars */}
                    {finTrend.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                            {finTrend.slice(-5).map((r: any, i: number) => (
                                <div key={i} className={styles.finMonthRow}>
                                    <span className={styles.finMonthLabel}>{String(r.period || "").slice(5)}</span>
                                    <div className={styles.finBarTrack}><div className={styles.finBarFill} style={{ width: `${Math.round(((r.revenue || 0) / maxFinTrend) * 100)}%` }} /></div>
                                    <span className={styles.finMonthVal}>{fmtCurr(r.revenue || 0)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right column: Inv Mix + Alerts */}
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <div className={styles.glassCard} style={{ flex: 1 }}>
                        <div className={styles.sectionTitle}><Layers size={13} /> Inventory Mix</div>
                        {invDist.length > 0 ? (
                            <>
                                <div style={{ height: 120 }}>
                                    <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
                                        <PieChart>
                                            <Pie data={invDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={32} outerRadius={52} paddingAngle={3}>
                                                {invDist.map((_: any, i: number) => <Cell key={i} fill={INV_COLORS[i % INV_COLORS.length]} />)}
                                            </Pie>
                                            <Tooltip content={<ChartTooltip />} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                {invDist.map((d: any, i: number) => (
                                    <div key={i} className={styles.invDistRow}>
                                        <div className={styles.invDot} style={{ background: INV_COLORS[i % INV_COLORS.length] }} />
                                        <div className={styles.invDistLabel}>{d.name}</div>
                                        <div className={styles.invDistTrack}><div className={styles.invDistFill} style={{ width: `${Math.round((d.value / Math.max(...invDist.map((x: any) => x.value), 1)) * 100)}%`, background: INV_COLORS[i % INV_COLORS.length] }} /></div>
                                        <div className={styles.invDistVal}>{fmt(d.value, 0)}</div>
                                    </div>
                                ))}
                            </>
                        ) : <div className={styles.emptyState}>No inventory data</div>}
                    </div>

                    {/* Action Alerts */}
                    <div className={styles.glassCard}>
                        <div className={styles.sectionTitle}><AlertCircle size={13} /> Action Required</div>
                        {alerts.length === 0 ? (
                            <div className={styles.allClear}><CheckCircle2 size={16} /> <span>No immediate actions</span></div>
                        ) : alerts.slice(0, 3).map((a: any, i: number) => (
                            <div key={i} className={`${styles.alertRow} ${a.type === "dispatch" ? styles.alertTeal : a.type === "overdue" ? styles.alertRose : styles.alertAmber}`}>
                                <div className={styles.alertCount}>{a.count}</div>
                                <div><div className={styles.alertTitle}>{a.title}</div><div className={styles.alertDesc}>{a.description}</div></div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* ─── ROW 5: PRODUCTION HEALTH + SCRAP TREND ─── */}
            <div className={`${styles.dualGrid} ${styles.animUp}`} style={{ animationDelay: "180ms" }}>
                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><Activity size={13} /> Production Health</div>
                    <div className={styles.healthBarsGrid}>
                        <HealthBar label="Machine Utilization" value={utilizationVal} fillClass={utilizationVal >= 60 ? styles.fillEmerald : styles.fillAmber} />
                        <HealthBar label="Issue Discipline" value={Math.min(disciplineVal, 100)} fillClass={disciplineVal >= 90 && disciplineVal <= 110 ? styles.fillEmerald : styles.fillRose} />
                        <HealthBar label="Return Efficiency" value={returnVal} fillClass={returnVal >= 70 ? styles.fillEmerald : styles.fillAmber} />
                        <HealthBar label="First Pass Yield" value={fpyPct} fillClass={fpyPct >= 92 ? styles.fillEmerald : fpyPct >= 80 ? styles.fillAmber : styles.fillRose} />
                        <HealthBar label="Gross Margin %" value={grossMarginPct} fillClass={grossMarginPct >= 30 ? styles.fillEmerald : grossMarginPct >= 15 ? styles.fillIndigo : styles.fillRose} />
                        <HealthBar label="Material Variance" value={Math.min(Math.abs(varianceVal), 15)} max={15} fillClass={Math.abs(varianceVal) <= 5 ? styles.fillEmerald : styles.fillRose} />
                    </div>
                </div>

                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><Flame size={13} /> Scrap Trend — 30 Days</div>
                    <div style={{ height: 150 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
                            <AreaChart data={scrapTrend} margin={{ top: 5, right: 8, left: -25, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="scrapG" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.03} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.08)" />
                                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} />
                                <Tooltip content={<ChartTooltip />} />
                                <Area type="monotone" dataKey="value" name="Scrap" stroke="#f43f5e" strokeWidth={2} fill="url(#scrapG)" dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 8 }}>
                        <span style={{ color: "#64748b" }}>Period Total</span>
                        <span style={{ color: "#f87171", fontWeight: 800 }}>{fmt(scrapVal)} KG</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 4 }}>
                        <span style={{ color: "#64748b" }}>Scrap Rate</span>
                        <span style={{ color: scrapRatePct > 5 ? "#f87171" : "#34d399", fontWeight: 800 }}>{fmt(scrapRatePct, 2)}%</span>
                    </div>
                </div>
            </div>

            {/* ─── ROW 6: JOB DIST · SHIFT PERF · ACTIVE JOBS ─── */}
            <div className={`${styles.triGrid} ${styles.animUp}`} style={{ animationDelay: "200ms" }}>
                {/* Job Distribution */}
                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><Package size={13} /> Job Distribution</div>
                    {jobDist.length > 0 ? (
                        <>
                            <div style={{ height: 150, position: "relative" }}>
                                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
                                    <PieChart>
                                        <Pie data={jobDist} dataKey="count" nameKey="job_state" cx="50%" cy="50%" innerRadius={42} outerRadius={60} paddingAngle={3}>
                                            {jobDist.map((e: any, i: number) => <Cell key={i} fill={JOB_COLORS[e.job_state] ?? "#2563eb"} />)}
                                        </Pie>
                                        <Tooltip content={<ChartTooltip />} />
                                    </PieChart>
                                </ResponsiveContainer>
                                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                                    <div style={{ textAlign: "center" }}>
                                        <div style={{ fontSize: 20, fontWeight: 900, color: "#a5b4fc" }}>{jobTotal}</div>
                                        <div style={{ fontSize: 8, color: "#475569", fontWeight: 700 }}>JOBS</div>
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8 }}>
                                {jobDist.map((d: any, i: number) => (
                                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                            <div style={{ width: 6, height: 6, borderRadius: 2, background: JOB_COLORS[d.job_state] ?? "#2563eb" }} />
                                            <span style={{ fontSize: 10, color: "#64748b", fontWeight: 600 }}>{d.job_state}</span>
                                        </div>
                                        <span style={{ fontSize: 10, color: "#a5b4fc", fontWeight: 800 }}>{d.count}</span>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : <div className={styles.emptyState}>No jobs</div>}
                </div>

                {/* Shift Performance */}
                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><Clock size={13} /> Shift Performance</div>
                    {shiftRows.length > 0 ? (
                        <>
                            <div style={{ height: 120 }}>
                                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
                                    <BarChart data={shiftRows} margin={{ top: 0, right: 5, left: -25, bottom: 0 }} barGap={2}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.07)" vertical={false} />
                                        <XAxis dataKey="shift_code" tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} />
                                        <YAxis tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} />
                                        <Tooltip content={<ChartTooltip />} />
                                        <Bar dataKey="output_kg" name="Output KG" fill="#2563eb" radius={[3, 3, 0, 0]} maxBarSize={22} />
                                        <Bar dataKey="scrap_kg" name="Scrap KG" fill="#f43f5e" radius={[3, 3, 0, 0]} maxBarSize={22} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            <table className={styles.shiftTable} style={{ marginTop: 8 }}>
                                <thead><tr>
                                    <th>Shift</th><th style={{ textAlign: "right" }}>Output</th>
                                    <th style={{ textAlign: "right" }}>Scrap</th><th style={{ textAlign: "right" }}>FPY%</th>
                                </tr></thead>
                                <tbody>
                                    {shiftRows.map((r: any, i: number) => (
                                        <tr key={i}>
                                            <td style={{ color: "#a5b4fc", fontWeight: 700 }}>{r.shift_code || "—"}</td>
                                            <td style={{ textAlign: "right" }}>{fmt(r.output_kg)}</td>
                                            <td style={{ textAlign: "right", color: "#f87171" }}>{fmt(r.scrap_kg)}</td>
                                            <td style={{ textAlign: "right", color: "#34d399" }}>{fmt(r.quality_pct)}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </>
                    ) : <div className={styles.emptyState}>No shift data</div>}
                </div>

                {/* Active Jobs */}
                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><Zap size={13} /> Active Jobs on Floor</div>
                    {activeJobs.length > 0 ? activeJobs.map((j: any, i: number) => (
                        <div key={i} className={styles.jobRow}>
                            <div className={styles.jobNumber}>{String(j.job_number || "—").slice(-7)}</div>
                            <div className={styles.jobProduct}>{j.product || "—"}</div>
                            <div className={styles.jobProgWrap}>
                                <div className={styles.jobProgTrack}><div className={styles.jobProgFill} style={{ width: `${j.progress || 0}%` }} /></div>
                                <div className={styles.jobProgPct}>{j.progress || 0}%</div>
                            </div>
                            <div className={styles.jobOp}>{j.operator || "?"}</div>
                        </div>
                    )) : (
                        <div className={styles.emptyState} style={{ flexDirection: "column", gap: 6 }}>
                            <Factory size={20} style={{ color: "#2563eb", opacity: 0.4 }} />
                            <span>No active jobs</span>
                        </div>
                    )}
                </div>
            </div>

            {/* ─── ROW 7: INK CONTROL · RISK SIGNALS ─── */}
            <div className={`${styles.dualGrid} ${styles.animUp}`} style={{ animationDelay: "220ms" }}>
                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><Droplets size={13} /> Ink Control</div>
                    <div className={styles.inkRow}><span className={styles.inkRowLabel}>Theoretical</span><span className={styles.inkRowValue}>{fmt(ink.theoretical_kg)} KG</span></div>
                    <div className={styles.inkRow}><span className={styles.inkRowLabel}>Planned Issue</span><span className={styles.inkRowValue}>{fmt(ink.planned_issue_kg)} KG</span></div>
                    <div className={styles.inkRow}><span className={styles.inkRowLabel}>Issued</span><span className={styles.inkRowValue}>{fmt(ink.issued_kg)} KG</span></div>
                    <div className={styles.inkRow}><span className={styles.inkRowLabel}>Returned</span><span className={styles.inkRowValue} style={{ color: "#67e8f9" }}>{fmt(ink.returned_kg)} KG</span></div>
                    <div className={styles.inkRow}><span className={styles.inkRowLabel}>Consumed</span><span className={styles.inkRowValue}>{fmt(ink.consumed_kg)} KG</span></div>
                    <div className={styles.inkRow}><span className={styles.inkRowLabel}>Variance</span><span className={styles.inkRowValue} style={{ color: parseFloat(String(ink.variance_kg || 0)) > 2 ? "#f87171" : "#34d399" }}>{fmt(ink.variance_kg)} KG</span></div>
                    <div className={styles.inkRow} style={{ borderTop: "1px solid rgba(99,102,241,0.1)", paddingTop: 8, marginTop: 4 }}>
                        <span className={styles.inkRowLabel}>Remix Ratio</span>
                        <span className={styles.inkBadge}>{fmt(ink.remix_ratio_pct, 1)}%</span>
                    </div>
                </div>

                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><Shield size={13} /> Risk Signals</div>
                    {risks.length === 0 ? (
                        <div className={styles.allClear}>
                            <CheckCircle2 size={16} />
                            <div><div style={{ fontWeight: 800 }}>All Clear</div><div style={{ fontSize: 10, opacity: 0.7, marginTop: 1 }}>No active risk signals</div></div>
                        </div>
                    ) : risks.map((r: any, i: number) => (
                        <div key={i} className={`${styles.riskBadge} ${r.severity === "HIGH" ? styles.riskHigh : r.severity === "MEDIUM" ? styles.riskMed : styles.riskLow}`}>
                            <span className={styles.riskDot} />
                            <div><div className={styles.riskCode}>{r.code}</div><div className={styles.riskMsg}>{r.message}</div></div>
                        </div>
                    ))}
                    <hr className={styles.divider} />
                    <div className={styles.sectionTitle} style={{ marginBottom: 8 }}>Material Control</div>
                    <div className={styles.inkRow}><span className={styles.inkRowLabel}>Issue Discipline</span><span className={styles.inkRowValue} style={{ color: disciplineVal > 110 ? "#f87171" : "#34d399" }}>{fmt(disciplineVal)}%</span></div>
                    <div className={styles.inkRow}><span className={styles.inkRowLabel}>Variance %</span><span className={styles.inkRowValue} style={{ color: Math.abs(varianceVal) > 10 ? "#f87171" : "#34d399" }}>{fmt(varianceVal)}%</span></div>
                    <div className={styles.inkRow}><span className={styles.inkRowLabel}>Return Efficiency</span><span className={styles.inkRowValue}>{fmt(returnVal)}%</span></div>
                </div>
            </div>

            {/* ─── ROW 8: TOP CUSTOMERS · SALES TREND · SKU ─── */}
            <div className={`${styles.triGrid} ${styles.animUp}`} style={{ animationDelay: "240ms" }}>
                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><Users size={13} /> Top Customers</div>
                    {topCustomers.length > 0 ? (() => {
                        const maxW = Math.max(...topCustomers.map((c: any) => c.total_weight || 0), 1);
                        return topCustomers.slice(0, 7).map((c: any, i: number) => (
                            <div key={i} className={styles.customerRow}>
                                <div className={styles.customerRank}>{i + 1}</div>
                                <div className={styles.customerName}>{c.customer_name || "—"}</div>
                                <div className={styles.customerBarTrack}><div className={styles.customerBarFill} style={{ width: `${Math.round(((c.total_weight || 0) / maxW) * 100)}%` }} /></div>
                                <div className={styles.customerWeight}>{fmt(c.total_weight)} KG</div>
                            </div>
                        ));
                    })() : <div className={styles.emptyState}>No data</div>}
                </div>

                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><Truck size={13} /> Sales Trend</div>
                    <div style={{ height: 180 }}>
                        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 1, height: 1 }}>
                            <AreaChart data={salesTrend} margin={{ top: 5, right: 8, left: -25, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="salesG" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.03} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(99,102,241,0.08)" />
                                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 9, fill: "#475569" }} axisLine={false} tickLine={false} />
                                <Tooltip content={<ChartTooltip />} />
                                <Area type="monotone" dataKey="weight" name="Weight KG" stroke="#06b6d4" strokeWidth={2} fill="url(#salesG)" dot={false} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><FileText size={13} /> SKU Performance</div>
                    {skuPerf.length > 0 ? (() => {
                        const maxS = Math.max(...skuPerf.map((s: any) => s.weight_kg || 0), 1);
                        return skuPerf.map((s: any, i: number) => (
                            <div key={i} className={styles.skuRow}>
                                <div className={styles.skuName} title={s.sku_name}>{s.sku_name || "—"}</div>
                                <div className={styles.skuBarTrack}><div className={styles.skuBarFill} style={{ width: `${Math.round(((s.weight_kg || 0) / maxS) * 100)}%` }} /></div>
                                <div className={styles.skuVal}>{fmt(s.weight_kg)} KG</div>
                            </div>
                        ));
                    })() : <div className={styles.emptyState}>No SKU data</div>}
                </div>
            </div>

            <div className={`${styles.dualGrid} ${styles.animUp}`} style={{ animationDelay: "260ms" }}>
                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><Layers size={13} /> Route Reuse Pools</div>
                    <div style={{ display: "grid", gap: 10 }}>
                        <div className={styles.overheadChip}>
                            <div className={styles.overheadLabel}>Final Roll Pool</div>
                            <div className={styles.overheadVal}>{fmt(routeReuse.final_roll_kg)} KG</div>
                        </div>
                        <div className={styles.overheadChip}>
                            <div className={styles.overheadLabel}>Invariant Pool</div>
                            <div className={styles.overheadVal}>{fmt(routeReuse.invariant_roll_kg)} KG</div>
                        </div>
                        <div className={styles.overheadChip}>
                            <div className={styles.overheadLabel}>Upstream Pool</div>
                            <div className={styles.overheadVal}>{fmt(routeReuse.upstream_roll_kg)} KG</div>
                        </div>
                    </div>
                </div>
                <div className={styles.glassCard}>
                    <div className={styles.sectionTitle}><Shield size={13} /> POD Intelligence</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
                        <div className={styles.finBreakCard}>
                            <div className={styles.finBreakLabel}>Active POD SKUs</div>
                            <div className={styles.finBreakVal} style={{ color: "#38bdf8" }}>{fmt(podKpis.active_pod_skus, 0)}</div>
                            <div className={styles.finBreakSub}>{fmt(podKpis.active_pod_variants, 0)} active variants</div>
                        </div>
                        <div className={styles.finBreakCard}>
                            <div className={styles.finBreakLabel}>POD Bulk Orders</div>
                            <div className={styles.finBreakVal} style={{ color: "#93c5fd" }}>{fmt(podKpis.bulk_orders, 0)}</div>
                            <div className={styles.finBreakSub}>{fmt(podKpis.bulk_target_kg)} KG target</div>
                        </div>
                    </div>
                </div>
            </div>
            </>
            )}

            {/* ─── ERROR ─── */}
            {query.isError && (
                <div className={`${styles.errorBanner} ${styles.animIn}`}>
                    <AlertTriangle size={15} /> <span>API failed — showing cached data. Click Refresh or ensure servers are running.</span>
                </div>
            )}
        </div>
    );
}

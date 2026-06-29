"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
    AlertTriangle,
    ArrowDown,
    ArrowRight,
    BarChart3,
    Box,
    CheckCircle2,
    Clock,
    Flame,
    Layers as LayersIcon,
    Package,
    Plus,
    RefreshCw,
    Rocket,
    Search,
    Send,
    Sparkles,
    TrendingUp,
    Zap,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { plannerService, type PlannerControlOrder } from "@/services/planner";
import { analyticsApi } from "@/services/analytics";
import { Card, Hero, Button, EmptyState, Chip } from "@/components/_planner-ui";
import { ageInfo, ageToneColor } from "../_shared/age";
import { OrderPassportStrip } from "../order-passport";
import { QuickStockLauncherDialog, type QuickStockLauncherSeed } from "../quick-stock-launcher-dialog";

function fmt(n: any, decimals = 0) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function pct(value: unknown): string {
    const v = Number(value);
    if (!Number.isFinite(v)) return "—";
    return `${v.toFixed(0)}%`;
}

interface TemplateBalance {
    templateName: string;
    templateId: string;
    stockKg: number;
    rolls: number;
    demandKg: number;
    openOrders: number;
    coverPct: number | null;
    deficitKg: number;
    status: "SHORT" | "TIGHT" | "COVERED" | "OVERSTOCK" | "STOCK_ONLY";
    fgType?: string;
    seed?: QuickStockLauncherSeed;
    linkedToTemplate: boolean;
}

function balanceStatus(stock: number, demand: number): TemplateBalance["status"] {
    if (demand <= 0 && stock > 0) return "STOCK_ONLY";
    if (demand <= 0) return "COVERED";
    const ratio = stock / demand;
    if (ratio < 0.5) return "SHORT";
    if (ratio < 1) return "TIGHT";
    if (ratio < 2) return "COVERED";
    return "OVERSTOCK";
}

function statusTone(s: TemplateBalance["status"]): { fg: string; bg: string; label: string } {
    switch (s) {
        case "SHORT": return { fg: "var(--danger)", bg: "rgba(244,63,94,.10)", label: "SHORT" };
        case "TIGHT": return { fg: "var(--warning)", bg: "rgba(245,158,11,.10)", label: "TIGHT" };
        case "COVERED": return { fg: "var(--success)", bg: "rgba(16,185,129,.10)", label: "COVERED" };
        case "OVERSTOCK": return { fg: "var(--i-700)", bg: "rgba(99,102,241,.10)", label: "OVERSTOCK" };
        case "STOCK_ONLY": return { fg: "var(--text-3)", bg: "var(--surface-2)", label: "STOCK READY" };
    }
}

function stockTemplateLabel(row: any): string {
    const linkedName = String(row?.template__name || "").trim();
    if (linkedName) return linkedName;
    const category = String(row?.fg_type || row?.stock_class || row?.source_path || "").trim();
    if (category) return `Unlinked ${category.toLowerCase()} stock`;
    return "Unlinked roll stock";
}

function demandTemplateLabel(row: PlannerControlOrder): string {
    return String(row.template_name || "").trim() || "Unlinked demand";
}

export default function StockIntelligenceTab() {
    const [search, setSearch] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | TemplateBalance["status"]>("all");
    const [launcherSeed, setLauncherSeed] = useState<QuickStockLauncherSeed | null>(null);

    const hubQ = useQuery({
        queryKey: ["planner-control-hub-si-v4"],
        queryFn: () => plannerService.getControlHub({ summary: true, planning_limit: 40, history_days: 30, history_limit: 10, active_limit: 20, timeout_ms: 12000 }),
        refetchInterval: 240_000,
        staleTime: 180_000,
        meta: { suppressGlobalError: true },
    });
    const stockQ = useQuery({
        queryKey: ["planner-stock-si-v3"],
        queryFn: () => plannerService.getStock(),
        refetchInterval: 240_000,
        staleTime: 180_000,
        meta: { suppressGlobalError: true },
    });
    const dashboardQ = useQuery({
        queryKey: ["planner-dashboard-si-v3"],
        queryFn: () => analyticsApi.getPlannerDashboard(),
        staleTime: 30_000,
        meta: { suppressGlobalError: true },
    });
    const jobsQ = useQuery({
        queryKey: ["planner-jobs-si-v3"],
        queryFn: () => plannerService.getJobs({
            limit: 40,
            states: ["PLANNED", "RELEASED", "WAITING", "EXECUTING", "PAUSED"],
            timeout_ms: 15000,
        }),
        staleTime: 180_000,
        meta: { suppressGlobalError: true },
    });

    const hubReady = hubQ.isSuccess && !hubQ.isError;
    const stockReady = stockQ.isSuccess && !stockQ.isError;
    const dashboardReady =
        dashboardQ.isSuccess &&
        Boolean((dashboardQ.data as any)?.generated_at) &&
        (dashboardQ.data as any)?.data_quality?.source_ready !== false;
    const stockIntelligenceReady = hubReady && stockReady && dashboardReady;
    const feedUnavailable =
        hubQ.isError ||
        stockQ.isError ||
        dashboardQ.isError ||
        (dashboardQ.dataUpdatedAt > 0 && !dashboardReady);
    const primaryLoading = hubQ.isLoading || stockQ.isLoading || dashboardQ.isLoading;

    const orders = stockIntelligenceReady ? hubQ.data?.orders ?? [] : [];
    const activeOrders = stockIntelligenceReady ? hubQ.data?.active_orders ?? [] : [];
    const history = stockIntelligenceReady ? hubQ.data?.order_history ?? [] : [];
    const stock: any[] = stockIntelligenceReady ? (stockQ.data as any) ?? [] : [];
    const dashboard: any = dashboardReady ? dashboardQ.data ?? {} : {};
    const allJobs: any[] = jobsQ.isSuccess ? jobsQ.data ?? [] : [];

    const queueKpis = dashboard.queue_kpis ?? {};
    const sourceMix = dashboard.source_mix ?? {};
    const replenishmentMix = dashboard.replenishment_mix ?? {};

    // Build a lookup of representative snapshots per template from open orders
    const templateSeeds = useMemo(() => {
        const map: Map<string, QuickStockLauncherSeed> = new Map();
        for (const o of [...orders, ...activeOrders]) {
            const key = String(o.template_id || o.template_name || "—");
            if (map.has(key)) continue;
            map.set(key, {
                template_id: o.template_id,
                template_name: o.template_name,
                fg_type: o.fg_type || o.final_product_type || undefined,
                geometry_snapshot: o.geometry_snapshot,
                layer_snapshot: Array.isArray(o.layer_snapshot) ? o.layer_snapshot : undefined,
                printing_snapshot: o.printing_snapshot,
                addons_snapshot: Array.isArray(o.addons_snapshot) ? o.addons_snapshot : undefined,
                packaging_snapshot: o.packaging_snapshot,
                stock_purpose: "PRODUCT",
            });
        }
        return map;
    }, [orders, activeOrders]);

    // ----- Aggregate stock by template -----
    const stockByTemplate = useMemo(() => {
        const map: Map<string, { name: string; id: string; kg: number; rolls: number; rows: any[]; linkedToTemplate: boolean }> = new Map();
        for (const s of stock) {
            const key = String(s.template__id || s.template__name || "—");
            if (!map.has(key)) {
                map.set(key, {
                    name: stockTemplateLabel(s),
                    id: String(s.template__id || ""),
                    kg: 0,
                    rolls: 0,
                    rows: [],
                    linkedToTemplate: Boolean(s.template__id || s.template__name),
                });
            }
            const e = map.get(key)!;
            e.kg += Number(s.total_weight || 0);
            e.rolls += Number(s.roll_count || 0);
            e.rows.push(s);
        }
        return map;
    }, [stock]);

    const demandByTemplate = useMemo(() => {
        const map: Map<string, { name: string; kg: number; orders: number; fgType?: string }> = new Map();
        for (const o of [...orders, ...activeOrders]) {
            const key = String(o.template_id || o.template_name || "—");
            if (!map.has(key)) {
                map.set(key, { name: demandTemplateLabel(o), kg: 0, orders: 0, fgType: o.fg_type });
            }
            const e = map.get(key)!;
            e.kg += Number(o.required_qty_kg || 0);
            e.orders += 1;
        }
        return map;
    }, [orders, activeOrders]);

    const balances = useMemo<TemplateBalance[]>(() => {
        const seen = new Set<string>();
        const out: TemplateBalance[] = [];
        for (const [key, s] of stockByTemplate.entries()) {
            seen.add(key);
            const d = demandByTemplate.get(key) || { kg: 0, orders: 0, fgType: undefined };
            const coverPct = d.kg > 0 ? (s.kg / d.kg) * 100 : null;
            const seed = templateSeeds.get(key);
            out.push({
                templateName: s.name, templateId: s.id,
                stockKg: s.kg, rolls: s.rolls,
                demandKg: d.kg, openOrders: d.orders,
                coverPct, deficitKg: d.kg - s.kg,
                status: balanceStatus(s.kg, d.kg),
                fgType: d.fgType,
                seed: seed ? { ...seed, deficit_kg: Math.max(0, d.kg - s.kg), suggested_qty_kg: Math.max(100, d.kg - s.kg) } : undefined,
                linkedToTemplate: s.linkedToTemplate,
            });
        }
        for (const [key, d] of demandByTemplate.entries()) {
            if (seen.has(key)) continue;
            const seed = templateSeeds.get(key);
            out.push({
                templateName: d.name, templateId: key,
                stockKg: 0, rolls: 0,
                demandKg: d.kg, openOrders: d.orders,
                coverPct: 0, deficitKg: d.kg,
                status: "SHORT",
                fgType: d.fgType,
                seed: seed ? { ...seed, deficit_kg: d.kg, suggested_qty_kg: d.kg } : undefined,
                linkedToTemplate: Boolean(seed?.template_id),
            });
        }
        return out.sort((a, b) => {
            const order = { SHORT: 0, TIGHT: 1, COVERED: 2, OVERSTOCK: 3, STOCK_ONLY: 4 };
            if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
            return b.demandKg - a.demandKg;
        });
    }, [stockByTemplate, demandByTemplate, templateSeeds]);

    const filteredBalances = useMemo(() => {
        let rows = balances;
        if (statusFilter !== "all") rows = rows.filter((r) => r.status === statusFilter);
        if (search) {
            const q = search.toLowerCase();
            rows = rows.filter((r) => r.templateName.toLowerCase().includes(q));
        }
        return rows;
    }, [balances, statusFilter, search]);

    // ----- KPIs -----
    const kpis = useMemo(() => {
        if (!stockIntelligenceReady) {
            return [
                { eyebrow: "Stock KG", value: "—", sub: "stock feed pending", accent: "default" as const },
                { eyebrow: "Demand KG", value: "—", sub: "control hub pending", accent: "default" as const },
                { eyebrow: "Coverage", value: "—", sub: "not calculated", accent: "default" as const },
                { eyebrow: "Short", value: "—", sub: "not calculated", accent: "default" as const },
                { eyebrow: "Tight", value: "—", sub: "not calculated", accent: "default" as const },
                { eyebrow: "FG batches", value: "—", sub: "source mix pending", accent: "default" as const },
                { eyebrow: "Packaging open", value: "—", sub: "planner feed pending", accent: "default" as const },
                { eyebrow: "POD open", value: "—", sub: "planner feed pending", accent: "default" as const },
            ];
        }
        const totalStockKg = balances.reduce((s, r) => s + r.stockKg, 0);
        const totalDemandKg = balances.reduce((s, r) => s + r.demandKg, 0);
        const totalRolls = balances.reduce((s, r) => s + r.rolls, 0);
        const shortCount = balances.filter((r) => r.status === "SHORT").length;
        const tightCount = balances.filter((r) => r.status === "TIGHT").length;
        const overCount = balances.filter((r) => r.status === "OVERSTOCK").length;
        const fgBatches = Number(sourceMix?.fg_batch_count || 0);
        const coverage = totalDemandKg > 0 ? (totalStockKg / totalDemandKg) * 100 : null;
        const packagingOpen = Number(replenishmentMix?.packaging_open || 0);
        const podOpen = Number(replenishmentMix?.pod_bulk_open || 0);

        return [
            { eyebrow: "Stock KG", value: fmt(totalStockKg, 0), sub: `${fmt(totalRolls)} rolls`, accent: "info" as const },
            { eyebrow: "Demand KG", value: fmt(totalDemandKg, 0), sub: "open queue", accent: "info" as const },
            {
                eyebrow: "Coverage",
                value: coverage == null ? "No demand" : pct(coverage),
                sub: coverage == null ? "no open demand rows" : "stock vs demand",
                accent: coverage == null ? ("default" as const) : coverage >= 80 ? ("success" as const) : coverage >= 40 ? ("warn" as const) : ("danger" as const),
            },
            { eyebrow: "Short", value: fmt(shortCount), sub: "templates < 50%", accent: shortCount > 0 ? ("danger" as const) : ("default" as const) },
            { eyebrow: "Tight", value: fmt(tightCount), sub: "templates 50-99%", accent: tightCount > 0 ? ("warn" as const) : ("default" as const) },
            { eyebrow: "FG batches", value: fmt(fgBatches), sub: "ready to ship", accent: "success" as const },
            { eyebrow: "Packaging open", value: fmt(packagingOpen), sub: "in-house production", accent: "default" as const },
            { eyebrow: "POD open", value: fmt(podOpen), sub: "bulk POD orders", accent: "default" as const },
        ];
    }, [balances, sourceMix, replenishmentMix, stockIntelligenceReady]);

    const idleStockTemplates = useMemo(() => {
        return balances
            .filter((r) => r.status === "STOCK_ONLY" || r.status === "OVERSTOCK")
            .sort((a, b) => b.stockKg - a.stockKg)
            .slice(0, 6);
    }, [balances]);

    // Top 3 critical for action banner
    const criticalShorts = useMemo(() => {
        return balances
            .filter((r) => r.status === "SHORT")
            .sort((a, b) => b.deficitKg - a.deficitKg)
            .slice(0, 3);
    }, [balances]);

    const stockPressureOrders = useMemo(() => {
        return [...orders]
            .filter((order) => {
                const coverage = Number(order.analytics?.coverage_pct ?? order.summary?.coverage_pct ?? 0);
                const hasAnyStock = Boolean(order.source_availability?.has_fg || order.source_availability?.has_wip);
                return coverage < 80 || !hasAnyStock;
            })
            .sort((a, b) => Number(b.required_qty_kg || 0) - Number(a.required_qty_kg || 0))
            .slice(0, 6);
    }, [orders]);

    // Funnel
    const funnel = useMemo(() => {
        const demand = orders.length + activeOrders.length;
        const plannable = orders.filter((o) => o.math_valid !== false).length;
        const releaseable = orders.filter((o) => {
            const blockers = ((o as any).blockers as any[] | undefined)?.length || 0;
            return o.math_valid !== false && blockers === 0 && (!o.artwork_assignment_required || !!o.assigned_artwork_id);
        }).length;
        const released = activeOrders.length;
        const completed = history.length;
        return [
            { stage: "Demand", value: demand, color: "var(--br-700)" },
            { stage: "Plannable", value: plannable, color: "var(--i-700)" },
            { stage: "Releaseable", value: releaseable, color: "var(--v-700)" },
            { stage: "Released", value: released, color: "var(--s-700)" },
            { stage: "Completed", value: completed, color: "var(--e-700)" },
        ];
    }, [orders, activeOrders, history]);

    const poolSlices = useMemo(() => {
        const slices = [
            { name: "FG Batches", value: Number(sourceMix?.fg_batch_count || 0), color: "#10b981", unit: "batches" },
            { name: "Invariant", value: Number(sourceMix?.invariant_roll_kg || 0), color: "#6366f1", unit: "KG" },
            { name: "Upstream", value: Number(sourceMix?.upstream_roll_kg || 0), color: "#0ea5e9", unit: "KG" },
            { name: "POD Bulk", value: Number(replenishmentMix?.pod_bulk_open || 0), color: "#f59e0b", unit: "open" },
            { name: "Packaging", value: Number(replenishmentMix?.packaging_open || 0), color: "#7c3aed", unit: "open" },
        ];
        return slices.filter((s) => s.value > 0);
    }, [sourceMix, replenishmentMix]);

    // Hot consumption (templates with most jobs running)
    const hotConsumers = useMemo(() => {
        const map: Map<string, { name: string; jobs: number; kg: number }> = new Map();
        for (const j of allJobs) {
            const state = String(j?.job_state || "").toUpperCase();
            if (!["EXECUTING", "RUNNING", "RELEASED", "WAITING"].includes(state)) continue;
            const name = String(j?.template_name || j?.product_name || "—");
            if (!map.has(name)) map.set(name, { name, jobs: 0, kg: 0 });
            const e = map.get(name)!;
            e.jobs++;
            e.kg += Number(j?.total_weight_kg || j?.quantity || 0);
        }
        return Array.from(map.values()).sort((a, b) => b.jobs - a.jobs).slice(0, 5);
    }, [allJobs]);

    const isFetching = hubQ.isFetching || stockQ.isFetching || dashboardQ.isFetching || jobsQ.isFetching;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Hero
                eyebrow="Planner Command Tower · Tab 5"
                title="Stock Intelligence"
                subtitle="Demand vs stock per template · packaging in-house · POD bulk · launcher direct-to-production · aged inventory."
                actions={
                    <div style={{ display: "flex", gap: 6 }}>
                        <Link href="/production/planner/stock-launcher" style={{ textDecoration: "none" }}>
                            <Button variant="secondary">
                                <Plus size={14} style={{ marginRight: 6 }} />
                                New stock order
                            </Button>
                        </Link>
                        <Button variant="ghost" onClick={() => { hubQ.refetch(); stockQ.refetch(); dashboardQ.refetch(); jobsQ.refetch(); }}>
                            <RefreshCw size={14} className={isFetching ? "spin" : ""} style={{ marginRight: 6 }} />
                            Refresh
                        </Button>
                    </div>
                }
                kpis={kpis as any}
            />

            {!stockIntelligenceReady ? (
                <Card>
                    <SectionHeader
                        eyebrow={feedUnavailable ? "Data feed unavailable" : "Loading source feeds"}
                        title="Stock intelligence is paused"
                        icon={<AlertTriangle size={16} color="var(--warning)" />}
                    />
                    <EmptyState
                        title={primaryLoading ? "Loading planner stock signals" : "Cannot calculate demand coverage yet"}
                        body="This page needs control-hub demand, planner stock, and planner-dashboard source-mix data together. Partial inputs are blocked so coverage, MRP pressure, packaging, and POD cards do not show misleading numbers."
                    />
                    <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Button variant="secondary" onClick={() => { hubQ.refetch(); stockQ.refetch(); dashboardQ.refetch(); jobsQ.refetch(); }}>
                            <RefreshCw size={14} style={{ marginRight: 6 }} />
                            Retry feeds
                        </Button>
                        <Chip kind={hubReady ? "ready" : "blocked"}>Control hub {hubReady ? "ready" : "pending"}</Chip>
                        <Chip kind={stockReady ? "ready" : "blocked"}>Stock {stockReady ? "ready" : "pending"}</Chip>
                        <Chip kind={dashboardReady ? "ready" : "blocked"}>Planner analytics {dashboardReady ? "ready" : "pending"}</Chip>
                    </div>
                </Card>
            ) : (
                <>

            {/* Critical Action Banner — dark, prominent */}
            {criticalShorts.length > 0 && (
                <Card style={{
                    background: "linear-gradient(135deg, #4c1d95 0%, #1e3a8a 50%, #0b1f55 100%)",
                    color: "#fff",
                    border: "1px solid rgba(255,255,255,.10)",
                    boxShadow: "var(--sh-md)",
                    overflow: "hidden",
                    position: "relative",
                }}>
                    <div style={{ position: "absolute", inset: 0, pointerEvents: "none",
                        background: "radial-gradient(800px 300px at 100% 0%, rgba(244,63,94,.18), transparent 60%)" }} />
                    <div style={{ position: "relative" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{
                                    width: 40, height: 40,
                                    borderRadius: "var(--r-3)",
                                    background: "rgba(244,63,94,.20)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                }}>
                                    <Flame size={20} color="#fda4af" />
                                </div>
                                <div>
                                    <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".10em", color: "rgba(255,255,255,.6)" }}>
                                        Critical · Build now
                                    </div>
                                    <div style={{ fontFamily: "var(--f-display)", fontSize: 20, fontWeight: 700, color: "#fff", marginTop: 2 }}>
                                        {criticalShorts.length} template{criticalShorts.length === 1 ? " is" : "s are"} short on stock vs demand
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
                            {criticalShorts.map((b) => (
                                <div key={b.templateId} style={{
                                    padding: "12px 14px",
                                    background: "rgba(255,255,255,.06)",
                                    border: "1px solid rgba(255,255,255,.10)",
                                    borderRadius: "var(--r-3)",
                                }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>
                                        {b.templateName}
                                    </div>
                                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
                                        <span style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 800, color: "#fda4af", lineHeight: 1 }}>
                                            {fmt(b.deficitKg, 0)}
                                        </span>
                                        <span style={{ fontSize: 10, color: "rgba(255,255,255,.6)", fontWeight: 700 }}>KG SHORT</span>
                                    </div>
                                    <div style={{ fontSize: 10, color: "rgba(255,255,255,.55)", fontFamily: "var(--f-mono)", marginBottom: 8 }}>
                                        {fmt(b.stockKg, 0)} / {fmt(b.demandKg, 0)} · {b.openOrders} order{b.openOrders === 1 ? "" : "s"}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => b.seed && setLauncherSeed(b.seed)}
                                        disabled={!b.seed}
                                        style={{
                                            width: "100%",
                                            padding: "7px 10px",
                                            fontSize: 11, fontWeight: 700,
                                            background: b.seed ? "rgba(255,255,255,.92)" : "rgba(255,255,255,.18)",
                                            color: b.seed ? "#0b1f55" : "rgba(255,255,255,.5)",
                                            border: "none",
                                            borderRadius: "var(--r-pill)",
                                            cursor: b.seed ? "pointer" : "not-allowed",
                                            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4,
                                        }}
                                    >
                                        <Rocket size={12} />
                                        Build & release
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>
            )}

            <Card>
                <SectionHeader
                    eyebrow="Planner stock pressure"
                    title="Order specs that need stock decisions"
                    icon={<AlertTriangle size={16} color="var(--warning)" />}
                />
                {stockPressureOrders.length === 0 ? (
                    <EmptyState title="No stock pressure rows" body="Open queue rows either have enough reusable stock or are already covered." />
                ) : (
                    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 10 }}>
                        {stockPressureOrders.map((order) => {
                            const coverage = Number(order.analytics?.coverage_pct ?? order.summary?.coverage_pct ?? 0);
                            const tone = coverage >= 80 ? "var(--success)" : coverage >= 40 ? "var(--warning)" : "var(--danger)";
                            return (
                                <div key={`${order.order_kind}:${order.order_id}:${order.sales_order_item_id || "order"}`} style={{
                                    padding: 12,
                                    border: "1px solid var(--border-soft)",
                                    borderRadius: "var(--r-3)",
                                    background: "var(--surface-1-soft)",
                                }}>
                                    <OrderPassportStrip order={order} compact />
                                    <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                                        <div style={{ flex: 1, height: 7, borderRadius: 999, overflow: "hidden", background: "var(--surface-2)" }}>
                                            <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, coverage))}%`, background: tone }} />
                                        </div>
                                        <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 900, color: tone, whiteSpace: "nowrap" }}>{pct(coverage)}</span>
                                        <Link href="/dashboard/planner/control-tower/plan-queue" style={{ textDecoration: "none" }}>
                                            <Button variant="secondary" size="sm">Plan</Button>
                                        </Link>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>

            {/* Funnel */}
            <Card className="is-emphasis">
                <SectionHeader
                    eyebrow="Source path funnel"
                    title="Demand → Plannable → Releaseable → Released → Completed"
                    icon={<ArrowDown size={16} color="var(--text-3)" />}
                />
                <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 6, overflowX: "auto", padding: "8px 0" }}>
                    {funnel.map((stage, i) => {
                        const max = funnel[0].value || 1;
                        const widthPct = (stage.value / max) * 100;
                        const dropoff = i > 0 ? funnel[i - 1].value - stage.value : 0;
                        return (
                            <div key={stage.stage} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                                <div style={{
                                    padding: "16px 22px",
                                    background: stage.color,
                                    color: "#fff",
                                    borderRadius: "var(--r-3)",
                                    minWidth: 140,
                                    opacity: 0.55 + (widthPct / 100) * 0.45,
                                    boxShadow: "var(--sh-md)",
                                }}>
                                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", opacity: 0.85 }}>
                                        {stage.stage}
                                    </div>
                                    <div style={{ fontFamily: "var(--f-display)", fontSize: 28, fontWeight: 800, marginTop: 2, lineHeight: 1 }}>
                                        {fmt(stage.value)}
                                    </div>
                                </div>
                                {i < funnel.length - 1 && (
                                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", color: "var(--text-3)", fontSize: 10, gap: 2 }}>
                                        <ArrowRight size={14} />
                                        {dropoff > 0 && <span style={{ fontFamily: "var(--f-mono)", fontWeight: 700, color: "var(--danger)" }}>−{dropoff}</span>}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </Card>

            {/* Demand vs Stock by Template — centerpiece */}
            <Card>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
                    <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <Flame size={16} color="var(--danger)" />
                            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--text-3)" }}>
                                Demand vs Stock
                            </span>
                        </div>
                        <div style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 700, color: "var(--text-1)", marginTop: 4 }}>
                            Where to build, where you&apos;re covered
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        {(["all", "SHORT", "TIGHT", "COVERED", "OVERSTOCK", "STOCK_ONLY"] as const).map((s) => {
                            const active = statusFilter === s;
                            const tone = s === "all" ? null : statusTone(s as TemplateBalance["status"]);
                            const label = s === "all" ? "All" : tone!.label;
                            const count = s === "all" ? balances.length : balances.filter((r) => r.status === s).length;
                            return (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() => setStatusFilter(s as any)}
                                    style={{
                                        padding: "5px 12px",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        background: active ? (tone?.bg || "var(--br-50)") : "var(--surface-1)",
                                        color: active ? (tone?.fg || "var(--br-700)") : "var(--text-2)",
                                        border: `1px solid ${active ? (tone?.fg || "var(--brand-600)") : "var(--border-soft)"}`,
                                        borderRadius: "var(--r-pill)",
                                        cursor: "pointer",
                                        display: "inline-flex", alignItems: "center", gap: 6,
                                    }}
                                >
                                    {label}
                                    <span style={{
                                        fontFamily: "var(--f-mono)", fontSize: 10,
                                        padding: "1px 6px", borderRadius: "var(--r-pill)",
                                        background: active ? "rgba(255,255,255,.7)" : "var(--surface-2)",
                                        color: active ? (tone?.fg || "var(--br-700)") : "var(--text-3)",
                                    }}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                        <div style={{ position: "relative", minWidth: 200 }}>
                            <Search size={12} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-4)" }} />
                            <input
                                type="text"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search template"
                                style={{
                                    width: "100%", padding: "6px 10px 6px 28px",
                                    fontSize: 11, fontFamily: "var(--f-ui)",
                                    background: "var(--surface-1)", border: "1px solid var(--border-soft)",
                                    borderRadius: "var(--r-pill)", outline: "none",
                                }}
                            />
                        </div>
                    </div>
                </div>

                {filteredBalances.length === 0 ? (
                    <EmptyState title="No matches" body="Adjust the status filter or clear search." />
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 540, overflowY: "auto" }}>
                        {filteredBalances.slice(0, 25).map((b) => (
                            <TemplateBalanceRow key={b.templateId} row={b} onLaunch={() => b.seed && setLauncherSeed(b.seed)} />
                        ))}
                        {filteredBalances.length > 25 && (
                            <div style={{ fontSize: 10, color: "var(--text-4)", textAlign: "center", padding: 6 }}>
                                +{filteredBalances.length - 25} more templates
                            </div>
                        )}
                    </div>
                )}
            </Card>

            {/* Packaging + POD side-by-side */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 18 }}>
                <PackagingStockCard
                    openCount={Number(replenishmentMix?.packaging_open || 0)}
                    balances={balances}
                    onLaunch={() => {
                        // Generic packaging launcher: open the dialog with no seed
                        // For now, a generic packaging seed; routes user to full launcher
                        setLauncherSeed({
                            label: "Packaging in-house stock",
                            stock_purpose: "PACKAGING",
                        });
                    }}
                />
                <PODStockCard
                    openCount={Number(replenishmentMix?.pod_bulk_open || 0)}
                    balances={balances}
                />
            </div>

            {/* Pool composition + Idle/Overstock */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr)", gap: 18 }}>
                <Card>
                    <SectionHeader
                        eyebrow="Pool composition"
                        title="By stock class"
                        icon={<LayersIcon size={16} color="var(--text-3)" />}
                    />
                    {poolSlices.length === 0 ? (
                        <EmptyState title="No positive stock pools" body="FG, WIP, fresh, packaging, and unlinked stock pools all returned zero in this view." />
                    ) : (
                        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "150px 1fr", gap: 14, alignItems: "center" }}>
                            <div style={{ height: 140, position: "relative" }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={poolSlices} cx="50%" cy="50%" innerRadius={42} outerRadius={64} paddingAngle={2} stroke="var(--surface-1)" strokeWidth={2} dataKey="value" nameKey="name">
                                            {poolSlices.map((s, i) => <Cell key={i} fill={s.color} />)}
                                        </Pie>
                                        <Tooltip contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border-soft)", borderRadius: "var(--r-3)", fontSize: 12 }}
                                            formatter={(v: any, n: any, item: any) => [`${fmt(Number(v), 1)} ${item.payload.unit}`, n]} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                {poolSlices.map((s) => (
                                    <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                                        <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                                        <span style={{ fontWeight: 600, color: "var(--text-2)" }}>{s.name}</span>
                                        <span style={{ marginLeft: "auto", fontFamily: "var(--f-mono)", color: "var(--text-2)" }}>{fmt(s.value, 1)} {s.unit}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </Card>

                <Card>
                    <SectionHeader
                        eyebrow="Hot consumers"
                        title="Templates with most active jobs"
                        icon={<TrendingUp size={16} color="var(--text-3)" />}
                    />
                    {hotConsumers.length === 0 ? (
                        <EmptyState title="No active consumption" body="Once jobs start running, top consuming templates appear here." />
                    ) : (
                        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                            {(() => {
                                const max = hotConsumers[0].jobs || 1;
                                return hotConsumers.map((h) => (
                                    <div key={h.name} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                                            <span style={{ fontWeight: 600, color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {h.name}
                                            </span>
                                            <span style={{ fontFamily: "var(--f-mono)", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                                                {h.jobs} job{h.jobs === 1 ? "" : "s"} · {fmt(h.kg, 0)} KG
                                            </span>
                                        </div>
                                        <div style={{ height: 5, background: "var(--surface-2)", borderRadius: 999, overflow: "hidden" }}>
                                            <div style={{ height: "100%", width: `${(h.jobs / max) * 100}%`, background: "linear-gradient(90deg, var(--br-500), var(--v-500))" }} />
                                        </div>
                                    </div>
                                ));
                            })()}
                        </div>
                    )}
                </Card>
            </div>

            {/* Idle/Overstock + Aged jobs */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 18 }}>
                <Card>
                    <SectionHeader
                        eyebrow="Idle & overstock"
                        title="Stock without matching demand"
                        icon={<Box size={16} color="var(--text-3)" />}
                    />
                    {idleStockTemplates.length === 0 ? (
                        <EmptyState title="Nothing idle" body="All stock has matching demand or is being consumed." />
                    ) : (
                        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                            {idleStockTemplates.map((t) => {
                                const tone = statusTone(t.status);
                                return (
                                    <div key={t.templateId} style={{
                                        padding: "10px 12px",
                                        background: "var(--surface-2)",
                                        borderRadius: "var(--r-3)",
                                        border: "1px solid var(--border-soft)",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                    }}>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                {t.templateName}
                                            </div>
                                            <div style={{ fontFamily: "var(--f-mono)", fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
                                                {fmt(t.stockKg, 1)} KG · {t.rolls} rolls · {t.openOrders} open orders
                                            </div>
                                        </div>
                                        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--r-pill)", background: tone.bg, color: tone.fg }}>
                                            {tone.label}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Card>

                <Card>
                    <SectionHeader
                        eyebrow="Aged in-flight"
                        title="Jobs stalled ≥ 3 days"
                        icon={<Clock size={16} color="var(--text-3)" />}
                    />
                    <AgedJobsList jobs={allJobs} />
                </Card>
            </div>

            {/* Launcher dialog */}
            <QuickStockLauncherDialog
                seed={launcherSeed}
                onClose={() => setLauncherSeed(null)}
            />
                </>
            )}
        </div>
    );
}

// ----- Template balance row with launcher -----

function TemplateBalanceRow({ row, onLaunch }: { row: TemplateBalance; onLaunch: () => void }) {
    const tone = statusTone(row.status);
    const stockBarWidth = row.coverPct == null ? 100 : Math.min(100, row.coverPct);
    const isShort = row.status === "SHORT" || row.status === "TIGHT";
    const canLaunch = !!row.seed && !!row.seed.template_id;
    return (
        <div style={{
            padding: "14px 16px",
            background: isShort ? "rgba(244,63,94,.03)" : "var(--surface-1-soft)",
            border: `1px solid ${isShort ? "rgba(244,63,94,.18)" : "var(--border-soft)"}`,
            borderRadius: "var(--r-3)",
            boxShadow: "var(--sh-flat)",
        }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
                            {row.templateName}
                        </span>
                        {row.fgType && <Chip kind={row.fgType.toLowerCase().includes("roll") ? "fg-roll" : "fg-pouch"}>{row.fgType}</Chip>}
                        <span style={{
                            fontSize: 9, fontWeight: 800, padding: "2px 8px",
                            borderRadius: "var(--r-pill)",
                            background: tone.bg, color: tone.fg,
                        }}>
                            {tone.label}
                        </span>
                        {!row.linkedToTemplate ? (
                            <span style={{
                                fontSize: 9,
                                fontWeight: 800,
                                padding: "2px 8px",
                                borderRadius: "var(--r-pill)",
                                background: "var(--warning-bg)",
                                color: "var(--warning-fg)",
                            }}>
                                LINK MASTER
                            </span>
                        ) : null}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--f-mono)" }}>
                        {row.openOrders} open order{row.openOrders === 1 ? "" : "s"} · {row.rolls} roll{row.rolls === 1 ? "" : "s"} in stock
                        {!row.linkedToTemplate ? " · product/template link missing" : ""}
                    </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ textAlign: "right" }}>
                        <div style={{ fontFamily: "var(--f-display)", fontSize: 20, fontWeight: 700, color: tone.fg, lineHeight: 1 }}>
                            {row.coverPct == null ? "No demand" : pct(row.coverPct)}
                        </div>
                        <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--text-3)", marginTop: 2 }}>
                            {row.coverPct == null ? "stock only" : "coverage"}
                        </div>
                    </div>
                    {(isShort || row.status === "STOCK_ONLY") && (
                        <button
                            type="button"
                            onClick={onLaunch}
                            disabled={!canLaunch}
                            title={canLaunch ? "Open quick stock launcher (auto-release)" : "No template seed available"}
                            style={{
                                padding: "7px 12px",
                                fontSize: 10, fontWeight: 800,
                                textTransform: "uppercase", letterSpacing: ".05em",
                                background: canLaunch ? (isShort ? "var(--danger)" : "var(--brand-600)") : "var(--surface-2)",
                                color: canLaunch ? "#fff" : "var(--text-4)",
                                border: "none",
                                borderRadius: "var(--r-pill)",
                                cursor: canLaunch ? "pointer" : "not-allowed",
                                display: "inline-flex", alignItems: "center", gap: 4,
                                boxShadow: canLaunch ? "var(--sh-sm)" : "none",
                            }}
                        >
                            <Rocket size={11} />
                            {isShort ? "Build now" : "Build more"}
                        </button>
                    )}
                </div>
            </div>

            <div style={{ position: "relative", height: 22, background: "var(--surface-2)", borderRadius: "var(--r-2)", overflow: "hidden", marginBottom: 8 }}>
                <div style={{
                    position: "absolute", left: 0, top: 0, bottom: 0,
                    width: `${stockBarWidth}%`,
                    background: row.status === "SHORT"
                        ? "linear-gradient(90deg, var(--danger), #fb7185)"
                        : row.status === "TIGHT"
                        ? "linear-gradient(90deg, var(--warning), #fb923c)"
                        : "linear-gradient(90deg, var(--success), #34d399)",
                    transition: "width var(--ds) var(--eo)",
                }} />
                <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, fontWeight: 700,
                    color: stockBarWidth > 30 ? "#fff" : "var(--text-2)",
                    fontFamily: "var(--f-mono)",
                    letterSpacing: ".05em",
                }}>
                    {fmt(row.stockKg, 0)} KG stock {row.demandKg > 0 ? `· ${fmt(row.demandKg, 0)} KG demand` : "· no open demand"}
                </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: "var(--text-3)", fontFamily: "var(--f-mono)" }}>
                <span>Stock: <strong style={{ color: "var(--text-1)" }}>{fmt(row.stockKg, 1)} KG</strong></span>
                <span>Demand: <strong style={{ color: "var(--text-1)" }}>{row.demandKg > 0 ? `${fmt(row.demandKg, 1)} KG` : "No open demand"}</strong></span>
                <span>{row.deficitKg > 0
                    ? <>Deficit: <strong style={{ color: "var(--danger)" }}>{fmt(row.deficitKg, 1)} KG</strong></>
                    : row.deficitKg < 0
                    ? <>Surplus: <strong style={{ color: "var(--i-700)" }}>{fmt(Math.abs(row.deficitKg), 1)} KG</strong></>
                    : <>Balanced</>}
                </span>
            </div>
        </div>
    );
}

// ----- Packaging Stock card -----

function PackagingStockCard({ openCount, balances, onLaunch }: { openCount: number; balances: TemplateBalance[]; onLaunch: () => void }) {
    // Heuristic: PACKAGING templates have FG type containing PACK or template name with "pack"
    const packagingRows = useMemo(() => {
        return balances.filter((b) => {
            const name = String(b.templateName || "").toLowerCase();
            const ft = String(b.fgType || "").toLowerCase();
            return name.includes("pack") || ft.includes("pack");
        }).slice(0, 5);
    }, [balances]);
    const totalKg = packagingRows.reduce((s, r) => s + r.stockKg, 0);

    return (
        <Card style={{
            background: "linear-gradient(135deg, rgba(124,58,237,.05) 0%, var(--surface-1) 60%)",
            borderColor: "rgba(124,58,237,.16)",
        }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Package size={16} color="var(--v-700)" />
                        <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--v-700)" }}>
                            Packaging in-house
                        </span>
                    </div>
                    <div style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 700, color: "var(--text-1)", marginTop: 4, lineHeight: 1.2 }}>
                        Outer packs we make ourselves
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onLaunch}
                    title="Launch new packaging stock production (auto-release)"
                    style={{
                        padding: "8px 14px",
                        fontSize: 11, fontWeight: 700,
                        background: "var(--v-700)", color: "#fff",
                        border: "none", borderRadius: "var(--r-pill)",
                        cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
                        boxShadow: "0 0 0 1px rgba(124,58,237,.18), 0 12px 28px -12px rgba(124,58,237,.32)",
                    }}
                >
                    <Plus size={12} />
                    New packaging
                </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 14 }}>
                <PoolStat label="Open production" value={fmt(openCount)} suffix="orders" tone="violet" />
                <PoolStat label="Stock on hand" value={fmt(totalKg, 0)} suffix="KG" tone="violet" />
            </div>

            {packagingRows.length === 0 ? (
                <div style={{
                    padding: "14px 16px",
                    background: "var(--surface-2)",
                    borderRadius: "var(--r-3)",
                    fontSize: 11,
                    color: "var(--text-3)",
                    textAlign: "center",
                }}>
                    No packaging templates with stock or demand right now.{" "}
                    <button
                        type="button"
                        onClick={onLaunch}
                        style={{ background: "none", border: "none", color: "var(--v-700)", fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}
                    >
                        Launch one
                    </button>
                    .
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {packagingRows.map((r) => {
                        const tone = statusTone(r.status);
                        return (
                            <div key={r.templateId} style={{
                                padding: "8px 10px",
                                background: "var(--surface-1)",
                                border: "1px solid var(--border-soft)",
                                borderRadius: "var(--r-2)",
                                display: "flex", alignItems: "center", gap: 8,
                            }}>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {r.templateName}
                                    </div>
                                    <div style={{ fontSize: 9, color: "var(--text-3)", fontFamily: "var(--f-mono)", marginTop: 1 }}>
                                        {fmt(r.stockKg, 0)} KG · {r.rolls} rolls
                                    </div>
                                </div>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--r-pill)", background: tone.bg, color: tone.fg }}>
                                    {tone.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

// ----- POD Stock card -----

function PODStockCard({ openCount, balances }: { openCount: number; balances: TemplateBalance[] }) {
    const podRows = useMemo(() => {
        return balances.filter((b) => {
            const name = String(b.templateName || "").toLowerCase();
            return name.includes("pod");
        }).slice(0, 5);
    }, [balances]);
    const totalKg = podRows.reduce((s, r) => s + r.stockKg, 0);

    return (
        <Card style={{
            background: "linear-gradient(135deg, rgba(245,158,11,.05) 0%, var(--surface-1) 60%)",
            borderColor: "rgba(245,158,11,.20)",
        }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Send size={16} color="var(--a-700)" />
                        <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--a-700)" }}>
                            POD bulk stock
                        </span>
                    </div>
                    <div style={{ fontFamily: "var(--f-display)", fontSize: 18, fontWeight: 700, color: "var(--text-1)", marginTop: 4, lineHeight: 1.2 }}>
                        Print-on-demand roll stock
                    </div>
                </div>
                <Link
                    href="/production/planner/stock-launcher?mode=pod"
                    style={{ textDecoration: "none" }}
                    title="Open full launcher to create POD bulk stock order"
                >
                    <button
                        type="button"
                        style={{
                            padding: "8px 14px",
                            fontSize: 11, fontWeight: 700,
                            background: "var(--a-700)", color: "#fff",
                            border: "none", borderRadius: "var(--r-pill)",
                            cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6,
                            boxShadow: "0 0 0 1px rgba(245,158,11,.18), 0 12px 28px -12px rgba(245,158,11,.32)",
                        }}
                    >
                        <Plus size={12} />
                        New POD
                    </button>
                </Link>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, marginBottom: 14 }}>
                <PoolStat label="Open POD orders" value={fmt(openCount)} suffix="bulk" tone="amber" />
                <PoolStat label="Stock on hand" value={fmt(totalKg, 0)} suffix="KG" tone="amber" />
            </div>

            {podRows.length === 0 ? (
                <div style={{
                    padding: "14px 16px",
                    background: "var(--surface-2)",
                    borderRadius: "var(--r-3)",
                    fontSize: 11,
                    color: "var(--text-3)",
                    textAlign: "center",
                }}>
                    No POD templates with stock or demand right now. Use the full launcher to create POD bulk orders.
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {podRows.map((r) => {
                        const tone = statusTone(r.status);
                        return (
                            <div key={r.templateId} style={{
                                padding: "8px 10px",
                                background: "var(--surface-1)",
                                border: "1px solid var(--border-soft)",
                                borderRadius: "var(--r-2)",
                                display: "flex", alignItems: "center", gap: 8,
                            }}>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {r.templateName}
                                    </div>
                                    <div style={{ fontSize: 9, color: "var(--text-3)", fontFamily: "var(--f-mono)", marginTop: 1 }}>
                                        {fmt(r.stockKg, 0)} KG · {r.rolls} rolls
                                    </div>
                                </div>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--r-pill)", background: tone.bg, color: tone.fg }}>
                                    {tone.label}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </Card>
    );
}

function PoolStat({ label, value, suffix, tone }: { label: string; value: string; suffix: string; tone: "violet" | "amber" }) {
    const colors = {
        violet: { bg: "rgba(124,58,237,.10)", fg: "var(--v-700)", border: "rgba(124,58,237,.20)" },
        amber: { bg: "rgba(245,158,11,.10)", fg: "var(--a-700)", border: "rgba(245,158,11,.20)" },
    }[tone];
    return (
        <div style={{
            padding: "10px 12px",
            background: colors.bg,
            border: `1px solid ${colors.border}`,
            borderRadius: "var(--r-3)",
        }}>
            <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: colors.fg }}>
                {label}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 2 }}>
                <span style={{ fontFamily: "var(--f-display)", fontSize: 22, fontWeight: 800, color: "var(--text-1)", lineHeight: 1 }}>
                    {value}
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-3)" }}>{suffix}</span>
            </div>
        </div>
    );
}

// ----- Aged jobs -----

function AgedJobsList({ jobs }: { jobs: any[] }) {
    const aged = useMemo(() => {
        const result: { j: any; days: number; tone: ReturnType<typeof ageToneColor> }[] = [];
        const now = Date.now();
        for (const j of jobs) {
            const state = String(j?.job_state || "").toUpperCase();
            if (!["WAITING", "PAUSED", "RELEASED"].includes(state)) continue;
            const planned = j?.planned_date ? new Date(j.planned_date).getTime() : null;
            if (!planned) continue;
            const days = Math.floor((now - planned) / (1000 * 60 * 60 * 24));
            if (days < 3) continue;
            const a = ageInfo(j.planned_date);
            if (!a) continue;
            result.push({ j, days, tone: ageToneColor(a.tone) });
        }
        return result.sort((a, b) => b.days - a.days).slice(0, 8);
    }, [jobs]);

    if (aged.length === 0) {
        return <EmptyState title="No aged jobs" body="All in-flight jobs are within 3 days of plan date." />;
    }
    return (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            {aged.map(({ j, days, tone }) => (
                <div key={j.id || j.job_number} style={{
                    padding: "10px 12px",
                    background: "var(--surface-2)",
                    borderRadius: "var(--r-2)",
                    border: "1px solid var(--border-soft)",
                    display: "flex", alignItems: "center", gap: 10,
                }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontFamily: "var(--f-mono)", fontSize: 11, fontWeight: 700, color: "var(--text-1)" }}>
                            {j.job_number}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {j.product_name || j.template_name} · {j.work_center_name || "Unassigned"}
                        </div>
                    </div>
                    <span style={{
                        fontSize: 10, fontWeight: 800,
                        padding: "3px 10px",
                        borderRadius: "var(--r-pill)",
                        background: tone.bg, color: tone.fg,
                        whiteSpace: "nowrap",
                    }}>
                        {days}d aged
                    </span>
                </div>
            ))}
        </div>
    );
}

function SectionHeader({ eyebrow, title, icon }: { eyebrow: string; title: string; icon?: React.ReactNode }) {
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
        </div>
    );
}

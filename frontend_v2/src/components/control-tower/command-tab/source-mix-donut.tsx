"use client";

import Link from "next/link";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, EmptyState, Button } from "@/components/_planner-ui";
import { Workflow, ShieldCheck, AlertTriangle, Plus, ArrowRight } from "lucide-react";

interface SourceMixDonutProps {
    sourceMix: {
        fg_batch_count?: number;
        invariant_roll_kg?: number;
        upstream_roll_kg?: number;
    };
    replenishmentMix: {
        pod_bulk_open?: number;
        packaging_open?: number;
    };
    queueKpis: {
        required_kg?: number;
        allocatable_kg?: number;
        coverage_pct?: number;
        ready_released?: number;
        blocked_count?: number;
        planning_queue?: number;
    };
    alerts: any[];
}

const SLICE_COLORS = ["#2563eb", "#6366f1", "#14b8a6", "#f59e0b", "#0ea5e9"];

function fmt(n: number, decimals = 1): string {
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

export function SourceMixDonut({ sourceMix, replenishmentMix, queueKpis, alerts }: SourceMixDonutProps) {
    // Coverage / readiness derivations from real fields
    const required = Number(queueKpis?.required_kg || 0);
    const allocatable = Number(queueKpis?.allocatable_kg || 0);
    const coverage = required > 0 ? Number(queueKpis?.coverage_pct || 0) : null;
    const ready = Number(queueKpis?.ready_released || 0);
    const blocked = Number(queueKpis?.blocked_count || 0);
    const planning = Number(queueKpis?.planning_queue || 0);
    const artworkPending = (alerts || [])
        .filter((a: any) => String(a?.type || "").toUpperCase().includes("ARTWORK"))
        .reduce((sum: number, a: any) => sum + Number(a?.count || 0), 0);
    const coverageTone = coverage == null ? "var(--text-3)" : coverage >= 80 ? "var(--success)" : coverage >= 40 ? "var(--warning)" : "var(--danger)";
    const totalTriage = ready + blocked + artworkPending;

    const slices = [
        { name: "FG Batches", value: Number(sourceMix.fg_batch_count || 0), unit: "batches", display: fmt(Number(sourceMix.fg_batch_count || 0), 0) },
        { name: "Invariant Pool", value: Number(sourceMix.invariant_roll_kg || 0), unit: "KG", display: fmt(Number(sourceMix.invariant_roll_kg || 0), 1) },
        { name: "Upstream Pool", value: Number(sourceMix.upstream_roll_kg || 0), unit: "KG", display: fmt(Number(sourceMix.upstream_roll_kg || 0), 1) },
        { name: "POD Bulk", value: Number(replenishmentMix.pod_bulk_open || 0), unit: "open", display: fmt(Number(replenishmentMix.pod_bulk_open || 0), 0) },
        { name: "Packaging", value: Number(replenishmentMix.packaging_open || 0), unit: "open", display: fmt(Number(replenishmentMix.packaging_open || 0), 0) },
    ];

    const total = slices.reduce((s, x) => s + x.value, 0);

    return (
        <Card>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <div>
                    <div className="t-eyebrow">Source Mix</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                        Stock pool composition
                    </div>
                </div>
                <Workflow size={16} color="var(--text-3)" />
            </div>

            {total <= 0 ? (
                <div style={{ marginTop: 16 }}>
                    <EmptyState title="No positive source pools" body="FG, roll, POD, and packaging pools all returned zero for this queue." />
                </div>
            ) : (
                <div
                    style={{
                        marginTop: 12,
                        display: "grid",
                        gridTemplateColumns: "180px 1fr",
                        gap: 14,
                        alignItems: "center",
                    }}
                >
                    <div style={{ height: 180 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie
                                    data={slices}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={48}
                                    outerRadius={76}
                                    dataKey="value"
                                    nameKey="name"
                                    paddingAngle={2}
                                    stroke="var(--surface-1)"
                                    strokeWidth={2}
                                >
                                    {slices.map((_, i) => (
                                        <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{
                                        background: "var(--surface-1)",
                                        border: "1px solid var(--border-soft)",
                                        borderRadius: "var(--r-3)",
                                        fontSize: 12,
                                        fontFamily: "var(--f-ui)",
                                    }}
                                    formatter={(value: any, name: any, item: any) => [
                                        `${fmt(Number(value), 1)} ${item.payload.unit}`,
                                        name,
                                    ]}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {slices.map((s, i) => {
                            const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
                            return (
                                <div
                                    key={s.name}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 10,
                                        fontSize: 12,
                                    }}
                                >
                                    <span
                                        style={{
                                            display: "inline-block",
                                            width: 10,
                                            height: 10,
                                            borderRadius: 4,
                                            background: SLICE_COLORS[i % SLICE_COLORS.length],
                                            flexShrink: 0,
                                        }}
                                    />
                                    <span style={{ fontWeight: 600, color: "var(--text-2)" }}>{s.name}</span>
                                    <span style={{ marginLeft: "auto", fontFamily: "var(--f-mono)", color: "var(--text-3)" }}>
                                        {s.display} {s.unit}
                                    </span>
                                    <span
                                        style={{
                                            fontFamily: "var(--f-mono)",
                                            fontSize: 11,
                                            color: "var(--text-4)",
                                            width: 36,
                                            textAlign: "right",
                                        }}
                                    >
                                        {pct}%
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Coverage bar — required vs allocatable */}
            <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--border-soft)" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                    <div className="t-eyebrow">Coverage</div>
                    <div style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 700, color: coverageTone }}>
                        {coverage == null ? "No demand" : `${coverage.toFixed(0)}%`}
                    </div>
                </div>
                <div
                    style={{
                        height: 10,
                        background: "var(--surface-2)",
                        borderRadius: 999,
                        overflow: "hidden",
                        position: "relative",
                    }}
                >
                    <div
                        style={{
                            width: `${coverage == null ? 0 : Math.min(100, Math.max(0, coverage))}%`,
                            height: "100%",
                            background: coverageTone,
                            transition: "width var(--ds) var(--eo)",
                        }}
                    />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11 }}>
                    <span style={{ color: "var(--text-3)" }}>
                        Allocatable <strong style={{ fontFamily: "var(--f-mono)", color: "var(--text-1)" }}>{fmt(allocatable, 1)}</strong> KG
                    </span>
                    <span style={{ color: "var(--text-3)" }}>
                        Required <strong style={{ fontFamily: "var(--f-mono)", color: "var(--text-1)" }}>{fmt(required, 1)}</strong> KG
                    </span>
                </div>
            </div>

            {/* Release readiness — Ready / Blocked / Artwork */}
            <div style={{ marginTop: 18 }}>
                <div className="t-eyebrow" style={{ marginBottom: 8 }}>Release readiness</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <ReadinessTile
                        icon={<ShieldCheck size={12} />}
                        label="Ready"
                        value={ready}
                        tone="success"
                        share={totalTriage > 0 ? (ready / totalTriage) * 100 : 0}
                    />
                    <ReadinessTile
                        icon={<AlertTriangle size={12} />}
                        label="Blocked"
                        value={blocked}
                        tone="danger"
                        share={totalTriage > 0 ? (blocked / totalTriage) * 100 : 0}
                    />
                    <ReadinessTile
                        icon={<AlertTriangle size={12} />}
                        label="Artwork"
                        value={artworkPending}
                        tone="warn"
                        share={totalTriage > 0 ? (artworkPending / totalTriage) * 100 : 0}
                    />
                </div>
                {planning > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-4)" }}>
                        {fmt(planning)} row{planning === 1 ? "" : "s"} in queue today
                    </div>
                )}
            </div>

            {/* Quick action */}
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-soft)", display: "flex", gap: 8 }}>
                <Link
                    href="/production/planner/stock-launcher"
                    style={{ textDecoration: "none", flex: 1 }}
                >
                    <Button variant="primary" style={{ width: "100%" }}>
                        <Plus size={14} style={{ marginRight: 6 }} />
                        New stock order
                    </Button>
                </Link>
                <Link
                    href="/dashboard/planner/control-tower/stock-intelligence"
                    style={{ textDecoration: "none" }}
                >
                    <Button variant="secondary">
                        Drill <ArrowRight size={14} style={{ marginLeft: 4 }} />
                    </Button>
                </Link>
            </div>
        </Card>
    );
}

function ReadinessTile({
    icon,
    label,
    value,
    tone,
    share,
}: {
    icon: React.ReactNode;
    label: string;
    value: number;
    tone: "success" | "warn" | "danger";
    share: number;
}) {
    const colors = {
        success: { fg: "var(--success)", bg: "rgba(16,185,129,.10)", border: "rgba(16,185,129,.22)" },
        warn: { fg: "var(--warning)", bg: "rgba(245,158,11,.10)", border: "rgba(245,158,11,.22)" },
        danger: { fg: "var(--danger)", bg: "rgba(244,63,94,.10)", border: "rgba(244,63,94,.22)" },
    }[tone];
    return (
        <div
            style={{
                padding: "10px 8px",
                borderRadius: "var(--r-3)",
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                display: "flex",
                flexDirection: "column",
                gap: 4,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 4, color: colors.fg, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em" }}>
                {icon}
                <span>{label}</span>
            </div>
            <div style={{ fontFamily: "var(--f-mono)", fontSize: 18, fontWeight: 700, color: "var(--text-1)" }}>
                {fmt(value, 0)}
            </div>
            <div
                style={{
                    height: 3,
                    width: "100%",
                    background: "rgba(255,255,255,.5)",
                    borderRadius: 999,
                    overflow: "hidden",
                }}
            >
                <div style={{ height: "100%", width: `${Math.min(100, share)}%`, background: colors.fg }} />
            </div>
        </div>
    );
}

export default SourceMixDonut;

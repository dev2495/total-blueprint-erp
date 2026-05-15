"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, ClipboardList, Inbox, Workflow } from "lucide-react";
import type { PlannerControlOrder } from "@/services/planner";
import { Card, EmptyState, Chip } from "@/components/_planner-ui";

interface ActionDeskProps {
    alerts: any[];
    orders: PlannerControlOrder[];
    jobs: any[];
}

function fmt(n: any): string {
    const v = Number(n);
    return Number.isFinite(v) ? v.toLocaleString("en-IN") : "—";
}

function StackHeader({ title, count, icon }: { title: string; count: number; icon: React.ReactNode }) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                marginBottom: 8,
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "var(--text-3)" }}>{icon}</span>
                <span
                    style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                        color: "var(--text-2)",
                    }}
                >
                    {title}
                </span>
            </div>
            <span
                style={{
                    fontFamily: "var(--f-mono)",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: "var(--r-pill)",
                    background: "var(--surface-2)",
                    color: "var(--text-3)",
                }}
            >
                {count}
            </span>
        </div>
    );
}

export function ActionDesk({ alerts, orders, jobs }: ActionDeskProps) {
    // Today's blockers — derive from orders with blockers field
    const blockedRows = orders
        .filter((o) => Array.isArray((o as any).blockers) && (o as any).blockers.length > 0)
        .slice(0, 6);

    // Next releases — orders math_valid + artwork resolved + has at least 1 ready inventory option
    const nextReleases = orders
        .filter((o) => o.math_valid !== false)
        .filter((o) => !o.artwork_assignment_required || !!o.assigned_artwork_id)
        .filter((o) => Array.isArray(o.inventory_options) && o.inventory_options!.length > 0)
        .slice(0, 5);

    // WCM handoff — jobs in RELEASED or WAITING grouped by work-center
    const handoffByWc: Record<string, number> = {};
    for (const j of jobs || []) {
        const state = String(j?.job_state || "").toUpperCase();
        if (state === "RELEASED" || state === "WAITING") {
            const wc = String(j?.work_center_name || j?.machine_name || "Unassigned");
            handoffByWc[wc] = (handoffByWc[wc] || 0) + 1;
        }
    }
    const handoffRows = Object.entries(handoffByWc)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    // Live alerts — only render rows the API actually returned (no padding)
    const liveAlerts = (alerts || []).slice(0, 6);

    return (
        <Card>
            <div className="t-eyebrow">Action Desk</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginTop: 2, marginBottom: 14 }}>
                What needs attention
            </div>

            {/* Today's Blockers */}
            <div style={{ marginBottom: 18 }}>
                <StackHeader
                    title="Today's blockers"
                    count={blockedRows.length}
                    icon={<AlertTriangle size={13} />}
                />
                {blockedRows.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text-4)", fontStyle: "italic" }}>
                        No blocked orders. Queue is clear.
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {blockedRows.map((o) => (
                            <Link
                                key={`${o.order_kind}-${o.order_id}`}
                                href={`/dashboard/planner/control-tower/plan-queue?order=${encodeURIComponent(o.order_id)}`}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "8px 10px",
                                    borderRadius: "var(--r-3)",
                                    background: "rgba(244,63,94,.06)",
                                    border: "1px solid rgba(244,63,94,.16)",
                                    textDecoration: "none",
                                    color: "var(--text-1)",
                                }}
                            >
                                <span style={{ fontFamily: "var(--f-mono)", fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>
                                    {o.order_number}
                                </span>
                                <span style={{ fontSize: 11, color: "var(--text-3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {((o as any).blockers || []).map((b: any) => b?.label || b?.message || b?.code).filter(Boolean).join(" · ") || "blocker"}
                                </span>
                                <ArrowRight size={12} color="var(--text-3)" />
                            </Link>
                        ))}
                    </div>
                )}
            </div>

            {/* Next Releases */}
            <div style={{ marginBottom: 18 }}>
                <StackHeader title="Next releases" count={nextReleases.length} icon={<ClipboardList size={13} />} />
                {nextReleases.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text-4)", fontStyle: "italic" }}>
                        No orders meet release criteria right now.
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {nextReleases.map((o) => (
                            <div
                                key={`${o.order_kind}-${o.order_id}`}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "6px 8px",
                                    borderRadius: "var(--r-2)",
                                    fontSize: 12,
                                }}
                            >
                                <span style={{ fontFamily: "var(--f-mono)", fontWeight: 700, color: "var(--text-2)" }}>
                                    {o.order_number}
                                </span>
                                <span style={{ color: "var(--text-3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {o.template_name}
                                </span>
                                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--text-3)" }}>
                                    {fmt(o.required_qty_kg)} KG
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* WCM Handoff */}
            <div style={{ marginBottom: 18 }}>
                <StackHeader title="WCM handoff" count={handoffRows.length} icon={<Workflow size={13} />} />
                {handoffRows.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--text-4)", fontStyle: "italic" }}>
                        No released or waiting jobs in flight.
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {handoffRows.map(([wc, count]) => (
                            <div
                                key={wc}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "6px 8px",
                                    fontSize: 12,
                                    borderRadius: "var(--r-2)",
                                    background: "var(--surface-2)",
                                }}
                            >
                                <span style={{ fontWeight: 600, color: "var(--text-2)", flex: 1 }}>{wc}</span>
                                <span
                                    style={{
                                        fontFamily: "var(--f-mono)",
                                        fontSize: 11,
                                        fontWeight: 700,
                                        color: "var(--text-3)",
                                    }}
                                >
                                    {count} jobs
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Live Alerts */}
            <div>
                <StackHeader title="Live alerts" count={liveAlerts.length} icon={<Inbox size={13} />} />
                {liveAlerts.length === 0 ? (
                    <EmptyState title="No alerts right now" body="The analytics feed is quiet." />
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {liveAlerts.map((a, i) => (
                            <div
                                key={i}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    padding: "8px 10px",
                                    borderRadius: "var(--r-3)",
                                    background: "var(--surface-1-soft)",
                                    border: "1px solid var(--border-soft)",
                                    fontSize: 12,
                                }}
                            >
                                <Chip kind="brand">{String(a?.type || "alert").replace(/_/g, " ")}</Chip>
                                <span style={{ color: "var(--text-2)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {a?.message || a?.label || "—"}
                                </span>
                                {a?.count != null && (
                                    <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--text-3)" }}>
                                        ×{fmt(a.count)}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Card>
    );
}

export default ActionDesk;

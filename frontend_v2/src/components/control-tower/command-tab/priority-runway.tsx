"use client";

import Link from "next/link";
import type { PlannerControlOrder } from "@/services/planner";
import { Card, Chip } from "@/components/_planner-ui";
import { HealthBar, type HealthSegment } from "../HealthBar";

interface PriorityRunwayProps {
    orders: PlannerControlOrder[];
}

function dueBucket(dateStr: string | null | undefined): { label: string; tone: "danger" | "warn" | "info" | "muted" } {
    if (!dateStr) return { label: "no due", tone: "muted" };
    const due = new Date(dateStr).getTime();
    if (Number.isNaN(due)) return { label: "no due", tone: "muted" };
    const now = Date.now();
    const days = Math.floor((due - now) / (1000 * 60 * 60 * 24));
    if (days < 0) return { label: `${Math.abs(days)}d overdue`, tone: "danger" };
    if (days === 0) return { label: "due today", tone: "danger" };
    if (days <= 2) return { label: `due in ${days}d`, tone: "warn" };
    if (days <= 7) return { label: `due in ${days}d`, tone: "info" };
    return { label: `due in ${days}d`, tone: "muted" };
}

function riskScore(o: PlannerControlOrder & { delivery_date?: string | null }): number {
    // Higher score = higher risk. Pure derivation from real fields.
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
    const allOverridden = lineCount > 0 && (o.material_plan_summary?.override_count ?? 0) === lineCount;
    const materialState: HealthSegment["state"] = lineCount === 0 ? "skip" : allOverridden ? "ok" : "warn";
    const routeState: HealthSegment["state"] =
        Number.isFinite(o.required_start_step) && Number.isFinite(o.route_last_step_index) ? "ok" : "warn";
    return [
        { key: "math", state: mathState, label: "Math", detail: mathState === "blocked" ? o.math_error || "Math invalid" : "Math valid" },
        { key: "artwork", state: artworkState, label: "Artwork", detail: !artworkRequired ? "Not required" : artworkAssigned ? "Assigned" : "Pending" },
        { key: "material", state: materialState, label: "Material", detail: `${o.material_plan_summary?.line_count ?? 0} lines` },
        { key: "route", state: routeState, label: "Route", detail: `Step ${o.required_start_step ?? "?"} → ${o.route_last_step_index ?? "?"}` },
    ];
}

export function PriorityRunway({ orders }: PriorityRunwayProps) {
    const sorted = [...orders].sort((a, b) => riskScore(b) - riskScore(a)).slice(0, 5);

    if (sorted.length === 0) {
        return (
            <Card>
                <div className="t-eyebrow">Priority Runway</div>
                <div style={{ marginTop: 6, fontSize: 14, color: "var(--text-3)" }}>
                    No open queue rows. The planner queue is fully cleared.
                </div>
            </Card>
        );
    }

    return (
        <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                    <div className="t-eyebrow">Priority Runway</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>Top 5 at-risk orders</div>
                </div>
                <Link
                    href="/dashboard/planner/control-tower/plan-queue"
                    style={{ fontSize: 12, fontWeight: 600, color: "var(--link)", textDecoration: "none" }}
                >
                    View Plan Queue →
                </Link>
            </div>

            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                {sorted.map((o) => {
                    const segments = deriveSegments(o);
                    const due = dueBucket((o as any).delivery_date);
                    const fgType = o.fg_type || o.final_product_type || "—";
                    return (
                        <div
                            key={`${o.order_kind}-${o.order_id}`}
                            style={{
                                border: "1px solid var(--border-soft)",
                                borderRadius: "var(--r-3)",
                                padding: 12,
                                background: "var(--surface-1-soft)",
                            }}
                        >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                        <span
                                            style={{
                                                fontFamily: "var(--f-mono)",
                                                fontSize: 12,
                                                fontWeight: 700,
                                                color: "var(--text-1)",
                                            }}
                                        >
                                            {o.order_number}
                                        </span>
                                        <Chip kind={fgType.toLowerCase().includes("roll") ? "fg-roll" : "fg-pouch"}>{fgType}</Chip>
                                        <Chip kind="tpl">{o.template_name}</Chip>
                                        {(o as any).customer_name && (
                                            <Chip kind="brand">{(o as any).customer_name}</Chip>
                                        )}
                                    </div>
                                    <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-3)" }}>
                                        {o.required_qty_kg
                                            ? `${Number(o.required_qty_kg).toLocaleString("en-IN", { maximumFractionDigits: 1 })} KG required`
                                            : "qty pending"}
                                        {o.qty_uom ? ` · UOM ${o.qty_uom}` : ""}
                                    </div>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end", whiteSpace: "nowrap" }}>
                                    {(() => {
                                        const placedAt = (o as any).created_at || (o as any).order_created_at;
                                        if (!placedAt) return null;
                                        const t = new Date(placedAt).getTime();
                                        if (Number.isNaN(t)) return null;
                                        const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
                                        const ageLabel = days === 0 ? "Today" : days === 1 ? "1d ago" : `${days}d ago`;
                                        const ageTone = days <= 3 ? "var(--success)" : days <= 7 ? "var(--info)" : days <= 14 ? "var(--warning)" : "var(--danger)";
                                        const ageBg = days <= 3 ? "rgba(16,185,129,.10)" : days <= 7 ? "rgba(14,165,233,.10)" : days <= 14 ? "rgba(245,158,11,.10)" : "rgba(244,63,94,.10)";
                                        return (
                                            <span style={{
                                                display: "inline-flex", alignItems: "center", gap: 5,
                                                padding: "3px 10px",
                                                fontSize: 11, fontWeight: 800,
                                                textTransform: "uppercase", letterSpacing: ".05em",
                                                borderRadius: "var(--r-pill)",
                                                background: ageBg, color: ageTone,
                                            }}>
                                                Placed {ageLabel}
                                            </span>
                                        );
                                    })()}
                                    <div
                                        style={{
                                            fontSize: 10,
                                            fontWeight: 600,
                                            color:
                                                due.tone === "danger"
                                                    ? "var(--danger)"
                                                    : due.tone === "warn"
                                                    ? "var(--warning)"
                                                    : "var(--text-4)",
                                            textTransform: "uppercase",
                                            letterSpacing: ".05em",
                                        }}
                                    >
                                        {due.label}
                                    </div>
                                </div>
                            </div>
                            <div style={{ marginTop: 10 }}>
                                <HealthBar segments={segments} showLabels />
                            </div>
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}

export default PriorityRunway;

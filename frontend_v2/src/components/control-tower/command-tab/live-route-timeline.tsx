"use client";

import { Card, EmptyState } from "@/components/_planner-ui";
import { Activity } from "lucide-react";

interface LiveRouteTimelineProps {
    jobs: any[];
}

const HOUR_BUCKETS = 12;

function fmt(n: any) {
    const v = Number(n);
    return Number.isFinite(v) ? v.toLocaleString("en-IN") : "—";
}

/**
 * Live Route Timeline — orders × 12 hours grid.
 * Real data: derive from jobs[] with started_at / completed_at timestamps.
 * If no timestamped jobs, render empty state — no fake events.
 */
export function LiveRouteTimeline({ jobs }: LiveRouteTimelineProps) {
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    // Real ProductionJob serializer fields: planned_date, closed_at, job_state.
    // "Active" = currently in flight (RELEASED/EXECUTING/WAITING/PAUSED) or recently closed.
    const activeStates = ["RELEASED", "EXECUTING", "RUNNING", "WAITING", "PAUSED"];
    const activeJobs = (jobs || [])
        .map((j: any) => {
            const state = String(j?.job_state || "").toUpperCase();
            const planned = j?.planned_date ? new Date(j.planned_date).getTime() : null;
            const closed = j?.closed_at ? new Date(j.closed_at).getTime() : null;
            const isActive = activeStates.includes(state);
            const wasRecentlyClosed = state === "COMPLETED" && closed != null && now - closed < HOUR_BUCKETS * hourMs;
            return { j, state, planned, closed, isActive, wasRecentlyClosed };
        })
        .filter((row) => row.isActive || row.wasRecentlyClosed)
        // Prioritize active over historical
        .sort((a, b) => {
            if (a.isActive && !b.isActive) return -1;
            if (!a.isActive && b.isActive) return 1;
            return (b.planned || 0) - (a.planned || 0);
        })
        .slice(0, 8);

    if (activeJobs.length === 0) {
        return (
            <Card>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                        <div className="t-eyebrow">Live Route Timeline</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                            Last {HOUR_BUCKETS} hours
                        </div>
                    </div>
                    <Activity size={16} color="var(--text-3)" />
                </div>
                <div style={{ marginTop: 14 }}>
                    <EmptyState
                        title="No active or recently-closed jobs"
                        body="In-flight jobs (RELEASED/EXECUTING/WAITING/PAUSED) and jobs closed in the last 12h will populate this timeline. Source: `/api/production/planner/jobs/`."
                    />
                </div>
            </Card>
        );
    }

    // Compute per-job hour buckets using planned_date as start anchor + closed_at for completion.
    const rows = activeJobs.map(({ j, state, planned, closed, isActive }) => {
        const buckets: ("idle" | "running" | "done")[] = [];
        for (let h = HOUR_BUCKETS - 1; h >= 0; h--) {
            const bucketStart = now - (h + 1) * hourMs;
            const bucketEnd = now - h * hourMs;
            const startedAtThisBucket = planned != null && planned <= bucketEnd;
            const stillOpenAtThisBucket = !closed || closed >= bucketStart;
            const closedInThisBucket = closed != null && closed >= bucketStart && closed <= bucketEnd;
            if (startedAtThisBucket && stillOpenAtThisBucket) {
                buckets.push(closedInThisBucket ? "done" : "running");
            } else if (closedInThisBucket) {
                buckets.push("done");
            } else {
                buckets.push("idle");
            }
        }
        const displayState = state || "";
        return {
            id: j.id || j.job_number || Math.random().toString(36),
            label: j.job_number || j.order_number || j.product_name || "job",
            wc: j.work_center_name || j.machine_name || "Unassigned",
            qty: j.total_weight_kg || j.quantity || null,
            uom: j.uom || "KG",
            buckets,
            state: displayState,
            isActive,
        };
    });

    return (
        <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <div>
                    <div className="t-eyebrow">Live Route Timeline</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-1)", marginTop: 2 }}>
                        {rows.length} job{rows.length === 1 ? "" : "s"} · last {HOUR_BUCKETS} hours
                    </div>
                </div>
                <Activity size={16} color="var(--text-3)" />
            </div>

            <div style={{ overflowX: "auto" }}>
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: `minmax(180px, 1.6fr) repeat(${HOUR_BUCKETS}, minmax(28px, 1fr))`,
                        gap: 4,
                    }}
                >
                    {/* Hour header */}
                    <div />
                    {Array.from({ length: HOUR_BUCKETS }, (_, i) => HOUR_BUCKETS - 1 - i).map((h) => (
                        <div
                            key={h}
                            style={{
                                fontSize: 10,
                                fontWeight: 600,
                                color: "var(--text-4)",
                                textAlign: "center",
                                fontFamily: "var(--f-mono)",
                            }}
                        >
                            -{h}h
                        </div>
                    ))}
                    {rows.map((r) => (
                        <TimelineRow key={r.id} row={r} />
                    ))}
                </div>
            </div>
        </Card>
    );
}

function TimelineRow({ row }: { row: any }) {
    return (
        <>
            <div
                style={{
                    fontSize: 12,
                    padding: "8px 10px",
                    background: "var(--surface-2)",
                    borderRadius: "var(--r-2)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    minWidth: 0,
                }}
            >
                <span
                    style={{
                        fontFamily: "var(--f-mono)",
                        fontWeight: 700,
                        color: "var(--text-1)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                >
                    {row.label}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-3)" }}>
                    {row.wc}
                    {row.qty ? ` · ${fmt(row.qty)} ${row.uom || "KG"}` : ""}
                    {row.state ? ` · ${row.state}` : ""}
                </span>
            </div>
            {row.buckets.map((b: "idle" | "running" | "done", i: number) => (
                <div
                    key={i}
                    style={{
                        background:
                            b === "running"
                                ? "rgba(37,99,235,.20)"
                                : b === "done"
                                ? "rgba(16,185,129,.18)"
                                : "var(--surface-2)",
                        border:
                            b === "running"
                                ? "1px solid rgba(37,99,235,.40)"
                                : b === "done"
                                ? "1px solid rgba(16,185,129,.32)"
                                : "1px solid var(--border-soft)",
                        borderRadius: "var(--r-2)",
                        height: 28,
                        animation: b === "running" ? "ds-pulse 1.6s var(--eo) infinite" : "none",
                    }}
                />
            ))}
        </>
    );
}

export default LiveRouteTimeline;

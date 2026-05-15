"use client";

/**
 * TraceTimeline — STUB (Phase 3, Completed Trace tab).
 *
 * Spec: PLANNER_CONTROL_TOWER_DESIGN.md §3.4 — "5-lane trace timeline (Planner → WCM → Machines → Packing → Dispatch)".
 *
 * When implemented:
 *   - Five horizontal lanes, one per role/stage
 *   - Each lane has a sequence of event chips with timestamps
 *   - Hover reveals operator + duration
 *   - Click → opens job-execution-card detail
 *
 * Real-data source: needs `/api/production/orders/{id}/trace/` endpoint (does not exist yet —
 * file under apps/production/views_planner.py for Phase 3).
 */

export interface TraceTimelineProps {
    salesOrderItemId?: string;
}

export function TraceTimeline(_props: TraceTimelineProps) {
    return null;
}

export default TraceTimeline;

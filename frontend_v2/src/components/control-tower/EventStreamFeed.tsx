"use client";

/**
 * EventStreamFeed — STUB (Phase 2, Live Production tab).
 *
 * Spec: PLANNER_CONTROL_TOWER_DESIGN.md §3.3 — "Live Event Stream (dark-themed feed)".
 *
 * When implemented:
 *   - Dark surface (var(--surface-3)) with green/amber/red event chips
 *   - Connects via SSE: `/api/production/events/stream/` (TBD endpoint — Phase 2 work)
 *   - Each row: timestamp · severity · job_id · message
 *   - Auto-scrolls newest at top; pause-on-hover
 *
 * No fake data — until SSE endpoint exists, this renders empty.
 */

export interface EventStreamFeedProps {
    plantId?: string;
}

export function EventStreamFeed(_props: EventStreamFeedProps) {
    return null;
}

export default EventStreamFeed;

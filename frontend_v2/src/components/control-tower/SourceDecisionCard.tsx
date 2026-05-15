"use client";

/**
 * SourceDecisionCard — STUB (Phase 1, Plan Queue tab).
 *
 * Spec: PLANNER_CONTROL_TOWER_DESIGN.md §3.2 — "Source Decision card (FG / WIP / Fresh, scored, recommended highlighted)".
 *
 * When implemented:
 *   - Three side-by-side scored options (FG match · WIP convertible · Fresh run)
 *   - Each shows: score (0-100), inventory available, rationale, ETA, $ delta
 *   - Recommended option highlighted with brand glow
 *   - Click → applies to selected order's plan_option state
 *
 * Real-data sources:
 *   - PlannerControlOrder.source_availability (has_fg, has_wip)
 *   - PlannerControlOrder.inventory_options (FG_BATCH and ROLL candidates)
 *   - PlannerControlOrder.matching_stock_orders
 *   - PlannerControlOrder.required_qty_kg vs allocatable
 */

export interface SourceDecisionCardProps {
    fgScore?: number;
    wipScore?: number;
    freshScore?: number;
    recommended?: "fg" | "wip" | "fresh" | null;
    onSelect?: (option: "fg" | "wip" | "fresh") => void;
}

export function SourceDecisionCard(_props: SourceDecisionCardProps) {
    return null;
}

export default SourceDecisionCard;

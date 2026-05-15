"use client";

/**
 * RouteStepper — STUB (Phase 1, Plan Queue tab).
 *
 * Spec: PLANNER_CONTROL_TOWER_DESIGN.md §3.2 — "Proposed Route Plan stepper".
 *
 * When implemented:
 *   - Visual stepper of route_steps[] with start/stop bracket
 *   - Each step: name, sequence, status (planned · running · done · skipped)
 *   - Highlights start_step_index and stop_step_index from PlannedStockOrder
 *   - Click step → drilldown into work-center / machine assignment
 *
 * Real-data source:
 *   - plannerService.getRouteSteps(templateId)
 *   - PlannerControlOrder.required_start_step / route_last_step_index
 */

export interface RouteStepperProps {
    steps?: Array<{ id: string; name: string; sequence: number; status?: string }>;
    startStepIndex?: number;
    stopStepIndex?: number;
}

export function RouteStepper(_props: RouteStepperProps) {
    return null;
}

export default RouteStepper;

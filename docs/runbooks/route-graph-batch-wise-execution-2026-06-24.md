# Route Graph And Batch-Wise Execution Implementation

Date: 2026-06-24

## Goal

Keep each sales-order line as one commercial demand while production can split that demand into live batches/lots, run independent or parallel route branches, wait for required join inputs, and show truthful batch, line, and order status across planner, WCM, machine, packing, dispatch, inventory, and sales views.

## Final Ownership Model

- Route Master owns the process graph: nodes, branches, dependencies, joins, and a backward-compatible linear route fallback.
- Template Studio owns product execution defaults: batch size, partial movement, auto-batch-on-output, branch labels, join labels, and matching rules.
- Sales order line owns the commercial demand and does not split commercially.
- Production batch owns the live factory lot/batch split for that sales line.
- Production job owns execution of one route node for one production batch.
- WCM and machine terminals may override live batch execution details without rewriting the route or template.

## Implementation Log

- Located the running app in `/Users/devarshthakkar/Documents/total_blueprint_erp/route_dispatch_release`.
- Confirmed `repair_worktree` is the only git checkout, but it is not the app currently served on ports 8000/3001.
- Confirmed the existing model already links production jobs, FG batches, packing units, dispatch lines, and inventory rolls back to `SalesOrderItem`.
- Confirmed current routes are linear through `RoutingRule.ordered_processes`; this implementation adds graph metadata while preserving that list.

## Data Model Decisions

- Add route graph JSON to `RoutingRule` so existing route records stay valid and linear routes are converted into graph nodes at runtime.
- Add batch execution policy JSON to `TemplateBlueprint` so product-specific defaults travel with the live template version.
- Add `ProductionBatch` for live production lots under a single `SalesOrderItem`.
- Add batch/route-node fields to `ProductionJob` so each machine/WCM job can represent one route node for one live batch.
- Link final `FinishedGoodsBatch` and `PackingUnit` rows to the live production batch when available.

## Status Rules

- Batch status is derived from its jobs and downstream objects:
  - `PLANNED`: no node released yet.
  - `RELEASED`: at least one node released.
  - `RUNNING`: at least one node executing.
  - `WAITING_JOIN`: branch/join dependencies are not all complete.
  - `PACKING_READY`: final route output exists and is available for packing.
  - `DISPATCH_READY`: sealed/available dispatch units exist.
  - `DISPATCHED`: all known dispatch units are dispatched.
  - `COMPLETED`: all batch jobs are complete and finished output is fully dispatched/completed.
- Sales line status remains a rollup over all jobs and batches for the line.
- Sales order status remains a rollup over its lines.

## UI Decisions

- Sales order list/detail must show line-level demand and nested batch progress.
- Planner live production must show route node and batch identifiers, not just one flat order status.
- WCM and machine views must show batch number, route branch/node, join inputs, and source sales line.
- Packing, dispatch, and inventory views must keep sales-line filters while exposing batch references when present.

## Verification Plan

- Django checks and targeted backend tests for route graph fallback, batch splitting, graph-aware release, and serializer rollups.
- Frontend type/build check for pages touched by batch route fields.
- Live API checks against the running local server after migration/restart.
- Browser/UI verification on sales orders, planner live production, WCM/machine, packing, dispatch, and inventory surfaces.


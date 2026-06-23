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
- Confirmed the live release folder is the app served on ports 8000/3001 and is a git checkout.
- Confirmed the existing model already links production jobs, FG batches, packing units, dispatch lines, and inventory rolls back to `SalesOrderItem`.
- Confirmed current routes are linear through `RoutingRule.ordered_processes`; this implementation adds graph metadata while preserving that list.
- Implemented legacy backfill for existing jobs that predated `ProductionBatch`: one `LEGACY_SINGLE` batch per sales-order line, with jobs linked back to the batch and route-node metadata populated where possible.

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

## Backend Completed

- `RoutingRule.route_graph` supports process nodes, edges, dependency declarations, branches, joins, and linear fallback.
- `TemplateBlueprint.batch_execution_policy` supports default batch sizing and execution flags.
- `ProductionBatch` tracks live lot/batch status under one `SalesOrderItem`.
- `ProductionJob` now carries `production_batch`, `route_node_id`, `route_branch_key`, predecessor node ids, and successor node ids.
- Final output (`FinishedGoodsBatch`) and packing units (`PackingUnit`) retain `production_batch`.
- `RouteGraphService` normalizes route graphs and only releases join nodes when all required branch predecessors are complete.
- `BatchExecutionService` creates batch splits for new work, rolls up status/quantities, serializes line summaries, and backfills legacy jobs.
- Added `backfill_production_batches` management command for deploy/backfill runs.
- Packing/dispatch payloads now include `production_batch_number`, `production_batch_status`, `route_node`, `route_node_id`, and `route_branch_key`.
- Inventory roll serializers expose production batch and route-node metadata derived from the owning/creating production job.

## UI Completed

- Sales order list and sales order detail show line-level batch summaries while the commercial line remains one demand.
- Planner live production route board uses route-node ids/branches and shows batch counts.
- WCM queue and selected-job header show production batch and route node/branch.
- Machine terminal selected job, queue cards, and history rows show production batch and route node/branch.
- Packing Yard shows batch chips in pouch batch, gonny, and roll release work tables.
- Dispatch manifest shows production batch and route node chips per physical unit.
- Inventory roll browse/card rows show production batch and route node for traceability.

## Data Backfill

- Added `python manage.py backfill_production_batches` for legacy jobs that predate `ProductionBatch`.
- Use `--dry-run` before writing, `--limit` for bounded batches, and `--sales-order-item-id <uuid>` for one targeted line.
- Local dry-run attempts were blocked by intermittent macOS FileProvider/Django-import stalls in this workspace, so do not treat local command output as backfill evidence.
- AWS container validation passed: `python manage.py backfill_production_batches --dry-run --limit 1` reported one candidate sales-order line and `created=0`.
- No production backfill write was performed in this session.

## Verification Results

- `.venv/bin/python manage.py test apps.production.tests_route_graph_batches apps.production.tests.test_planner_stock_launcher apps.production.tests.test_product_commitment apps.templates.test_step_contracts apps.templates.test_route_dispatch --noinput --keepdb --verbosity 1`: passed, 39 tests.
- `.venv/bin/python manage.py check`: passed.
- `.venv/bin/python manage.py makemigrations --check --dry-run`: passed, no model drift.
- `python -m py_compile apps/production/management/commands/backfill_production_batches.py apps/production/tests_route_graph_batches.py`: passed.
- `npm run build` / guarded `next build`: passed.
- `npm run lint`: passed with one pre-existing Next font warning in `frontend_v2/src/app/layout.tsx`.
- `./start_all.sh verify`: passed deep route and asset verification.
- `SMOKE_EMAIL=admin SMOKE_PASSWORD=admin123 FRONTEND_BASE_URL=http://127.0.0.1:3001 ./scripts/release_smoke_checks.sh`: passed.
- The focused rerun of `apps.production.tests_route_graph_batches` after adding the management-command test was blocked by the same local FileProvider/Django-import stall, so that individual new test must be treated as syntax-checked locally until it is run in the Linux deployment container.

## Browser Note

- Local Playwright Chromium and Chrome launches failed in the macOS sandbox with browser-launch permission/MachPort failures.
- MCP browser action was then rejected by the desktop usage limit.
- Because browser automation was blocked outside the app itself, final UI verification evidence is from production build, deep route/asset verification, authenticated API payload probes, and live service health.

## Deployment Notes

- Local release stack was verified with the new build, then stopped before final packaging.
- AWS target/config: Lightsail host `3.6.77.159` / `erp.totalpolyprint.com`, key `.runtime/aws_keys/lightsail-ap-south-1.pem`, app root `/opt/tpp-erp/app`, Docker Compose file `deploy/aws/docker-compose.yml`.
- AWS deployment completed from this checkout by rsyncing source to `/opt/tpp-erp/app`, rebuilding the live `aws-*` Compose images, applying migrations, and force-recreating backend, worker, beat, and frontend.
- Live post-deploy checks passed:
  - `https://erp.totalpolyprint.com/api/health/live/`: HTTP 200.
  - `https://erp.totalpolyprint.com/api/health/ready/`: HTTP 200.
  - `https://erp.totalpolyprint.com/login`: HTTP 200.
  - `https://erp.totalpolyprint.com/engineering/templates`: HTTP 200.
  - `https://erp.totalpolyprint.com/engineering/routing`: HTTP 200.
  - `https://erp.totalpolyprint.com/logistics/dispatch`: HTTP 200.
  - `https://erp.totalpolyprint.com/logistics/packing`: HTTP 200.
  - `https://erp.totalpolyprint.com/production/machine-selector`: HTTP 200.
- Recent AWS backend, frontend, worker, and beat logs had no `ERROR`, `CRITICAL`, `Traceback`, `Exception`, `DisallowedHost`, `Forbidden`, or `failed` hits after deploy.

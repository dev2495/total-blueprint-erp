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
- Route Master edit/create now stays flow-only: users add route steps, then mark a step as `+ Runs together` when it can run in parallel with the previous step.
- Route Master cards now show a readable stage flow with colored process chips, `+` parallel rows, stage count, and parallel-branch count; no batch size, lot prefix, movement, release, or matching-policy controls are shown there.
- Route Master saves graph topology only: route nodes and edges. Routing API input strips legacy `execution_policy`, `batch_execution_policy`, and `batch_policy` keys from submitted route graphs.
- Template Studio detail owns all batch and lot execution behavior: batch size KG/PCS, lot prefix, auto batch creation, partial movement, `+` branch release, and join matching before the next stage.
- Template Studio shows the selected Route Master flow as read-only context so users can see where execution rules apply without editing the route from the template page.
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
- Final production container check on AWS: `sudo docker compose -f deploy/aws/docker-compose.yml exec -T backend python manage.py check` passed with no issues.
- Final AWS migration audit confirmed `production.0065_production_batch_route_graph`, `routing.0003_routingrule_route_graph`, and `templates.0034_templateblueprint_batch_execution_policy` applied.
- Final AWS model probe returned live data: `production_batches=10`, `jobs_with_batch=18`, `routes_with_graph_field=36`, and `templates_with_policy_field=75`.
- Final AWS dry-run backfill probe succeeded: `python manage.py backfill_production_batches --dry-run --limit 1` processed one candidate and created no records.
- Final AWS protected API probe used DRF `force_authenticate` inside the backend container, without changing production credentials:
  - Sales orders returned HTTP 200 and line items expose `production_batch_summary`.
  - Production batches returned HTTP 200 with 10 rows and `current_route_node_id` / route branch state.
  - WCM queue returned HTTP 200 with 35 rows and nested `production_batch_number`, `route_node`, and `route_node_id`.
  - Machine history returned HTTP 200 and its job payload shape includes `production_batch_number`, `route_node`, and `route_node_id`.
  - Inventory rolls returned HTTP 200 with 1659 rows and `production_batch_number` / `route_node`.
  - Planner live summary, packing batches, packing gonnies, and dispatch item summary returned HTTP 200; the sampled AWS production data currently had no packing/dispatch physical rows to inspect field-level payloads there.
- Follow-up correction after the live Route Master screenshot showed the old linear-only modal: the source was already on `origin/main`, but the live frontend container had to be rebuilt and force-recreated again before the browser could serve the new visible graph controls.
- AWS rebuild passed for `backend`, `frontend`, `worker`, and `beat`; the frontend production build compiled successfully and included `/engineering/routing`, `/engineering/templates`, and `/engineering/templates/[id]`.
- AWS recreate completed after one transient stale Docker container reference retry; final running containers were `aws-backend-1`, `aws-frontend-1`, `aws-worker-1`, `aws-beat-1`, `aws-postgres-1`, and `aws-redis-1`.
- Final correction-pass checks passed: `python manage.py check`, `https://erp.totalpolyprint.com/api/health/ready/`, `https://erp.totalpolyprint.com/engineering/routing`, and `https://erp.totalpolyprint.com/engineering/templates`.
- Route/template UX simplification follow-up:
  - `env PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m py_compile apps/routing/serializers.py apps/routing/tests.py apps/production/services/batch_route_service.py apps/production/tests_route_graph_batches.py apps/templates/serializers.py`: passed.
  - `env PYTHONDONTWRITEBYTECODE=1 .venv/bin/python manage.py test apps.routing.tests apps.production.tests_route_graph_batches --keepdb --noinput --verbosity 1`: passed, 7 tests.
  - `env PYTHONDONTWRITEBYTECODE=1 .venv/bin/python manage.py check`: passed.
  - Local `npm run typecheck`, targeted ESLint, and direct `tsc --noEmit` were stopped after they hung silently following route type generation; production Docker frontend build is the decisive frontend gate for this follow-up.
  - AWS Docker build passed for backend, frontend, worker, and beat; frontend `npm run build` passed TypeScript, route type generation, and optimized Next.js production build.
  - AWS force-recreate completed for backend, frontend, worker, and beat.
  - Post-recreate AWS checks passed: `python manage.py check`, running container health, `https://erp.totalpolyprint.com/api/health/ready/`, `https://erp.totalpolyprint.com/engineering/routing`, and `https://erp.totalpolyprint.com/engineering/templates`.
  - Final compiled-bundle proof from the running AWS frontend image:
    - `Route flow`, `+ Runs together`, and `Route Master controls flow only` found in `.next/server/app/(dashboard)/engineering/routing/page.js`.
    - `Batch and lot execution` and `Save template execution` found in `.next/server/app/(dashboard)/engineering/templates/[id]/page.js`.
    - Old confusing Route Master labels `Batch route graph` and `Default batch size KG` were absent from `.next/server/app/(dashboard)/engineering/routing/page.js`.

## Browser Note

- Local Playwright Chromium and Chrome launches failed in the macOS sandbox with browser-launch permission/MachPort failures.
- MCP browser action was then rejected by the desktop usage limit.
- Final Playwright MCP production check loaded `https://erp.totalpolyprint.com/login` and captured a full-page screenshot.
- Final Playwright MCP production check opened `https://erp.totalpolyprint.com/production/machine-selector`; unauthenticated access redirected cleanly to `/login` and captured a full-page screenshot.
- Full authenticated production UI browsing was not completed because the available `admin/admin123` credentials are not valid on AWS. Production UI evidence is therefore from build, deep route/asset verification, live route probes, unauthenticated Playwright render checks, and server-side Django/model checks.

## Deployment Notes

- Local release stack was verified with the new build, then stopped before final packaging.
- AWS target/config: Lightsail host `3.6.77.159` / `erp.totalpolyprint.com`, key `.runtime/aws_keys/lightsail-ap-south-1.pem`, app root `/opt/tpp-erp/app`, Docker Compose file `deploy/aws/docker-compose.yml`.
- AWS deployment completed from this checkout by rsyncing source to `/opt/tpp-erp/app`, rebuilding the live `aws-*` Compose images, applying migrations, and force-recreating backend, worker, beat, and frontend.
- Git push completed: the route/batch release commits were pushed to `origin/main`.
- Final AWS source hash audit matched local and server copies for the core route/batch backend files, route/template models, planner live production component, and this runbook.
- Live post-deploy checks passed:
  - `https://erp.totalpolyprint.com/api/health/live/`: HTTP 200.
  - `https://erp.totalpolyprint.com/api/health/ready/`: HTTP 200.
  - `https://erp.totalpolyprint.com/login`: HTTP 200.
  - `https://erp.totalpolyprint.com/engineering/templates`: HTTP 200.
  - `https://erp.totalpolyprint.com/engineering/routing`: HTTP 200.
  - `https://erp.totalpolyprint.com/logistics/dispatch`: HTTP 200.
  - `https://erp.totalpolyprint.com/logistics/packing`: HTTP 200.
  - `https://erp.totalpolyprint.com/production/machine-selector`: HTTP 200.
- Recent AWS backend, frontend, worker, and beat containers are up and healthy. Log review showed only expected client/auth/404 warnings from verification probes, not a container crash or failed migration.

# Planner Control Tower Current Upgrade Report

Date: 2026-06-29

Latest patch: 2026-06-29 20:13 IST

## Scope

- Upgraded the existing `/dashboard/planner/control-tower/...` page only.
- Removed the separate v2/v3 comparison route exposure and local comparison backend routes.
- Kept the current control tower tab structure: Command, Plan Queue, Live Production, Completed Trace, Stock Intelligence, Combine Orders.

## Completed Changes

- Added a shared `order-passport` renderer for planner order lines.
- Prominently shows product master code/name, sales line, pouch/roll form, size, thickness expression such as `12+40 um`, layer variant code/name, print profile, add-ons, packaging/POD signals, and three order intent KPIs.
- Applied the passport strip in Plan Queue rows, Command priority runway, Live Production cards, Completed Trace rows, and Stock Intelligence stock-pressure rows.
- Rebuilt Live Production around a line-level production traveller instead of FG/WIP/Fresh source columns.
- Replaced the misleading multi-lane SVG route graph with:
  - Source decision cards for FG/WIP/Fresh/reuse choices.
  - Release gate cards for material, artwork, release, and WCM handoff state.
  - A real production traveller driven by template route steps only.
  - Step cards that show process, input/output form, dispatch policy, default work center, roll behavior, combine/parallel lanes, job count, material rows, and WIP progress.
- Added live job ledger cards with job state, process/work center/machine/operator, input-output flow, posted vs target quantity, scrap, and updated/closed timestamps.
- Added material issue cards with step/category/policy and planned issue quantities.
- Added planner override rule cards beside the actions so users can see when cancel vs short-close is valid before clicking.
- Added pagination to Live Production order cards.
- Improved Live Production scroll smoothness and layout stability:
  - Added responsive layout classes for the filter bar, order list, and right-side insight rail.
  - Added `content-visibility` to live order cards so off-screen cards do less render work.
  - Reduced nested scrolling inside dense order cards by showing the most relevant WCM/material rows inline and summarizing overflow rows.
  - Added stable route-rail horizontal scrolling with touch-friendly overscroll behavior.
- Expanded Completed Trace with the same completed-mode production traveller and removed duplicate low-detail route/job/material chip sections.
- Added pagination to Completed Trace rows and reset paging on period/search/customer/source filter changes.
- Improved Completed Trace scrolling:
  - Removed the nested 800px closed-order scroll well so the page uses one natural scroll path.
  - Reduced page size to 18 closed rows for smoother row expansion.
  - Added responsive chart/list/aside grids and `content-visibility` on closed-order rows.
- Replaced misleading capacity/free-slot language in Command with WCM handoff, queue, blocker, coverage, and source-backed production signals.
- Added Stock Intelligence stock-pressure order cards so aggregate stock decisions are tied back to exact order specs.

## 2026-06-29 Live Job Ledger Polish

- Reworked the shared `ProductionTracePanel` used by Live Production and Completed Trace so KG is now the primary planner unit.
- Added quantity normalization in `frontend_v2/src/components/control-tower/order-passport.tsx`:
  - Uses direct KG fields where present: `total_weight_kg`, `produced_qty_kg`, `remaining_qty_kg`, `scrap_qty_kg`.
  - Converts raw PCS job quantities to KG through `unit_weight_g` from the job or parent order.
  - Keeps raw WCM UOM values as a secondary system-log line instead of making PCS look like planner weight.
- Replaced generic trace KPI cards with production-specific cards:
  - Step target KG.
  - Posted output KG.
  - Open balance KG.
  - Current step and active/waiting job counts.
  - Route source and route span.
- Rebuilt route-step summary cards to show target KG, posted KG, open KG, job count, material signal, and progress rail per step.
- Rebuilt job ledger cards to show:
  - Step target KG, posted KG, open KG, scrap KG.
  - Input -> output flow.
  - Raw WCM system log such as `WCM posted 0 / 2,200 PCS` when the underlying job is piece-based.
  - Operator, update/close timestamp, batch number when available, state pill, and progress rail.
- Updated the Live Production order-card header quantity to use the same KG summary logic, removing mixed displays like `0 / 9.6 PCS`.
- Extended `frontend_v2/tests/e2e/observation/planner-ui-regression.spec.ts` so the browser regression now checks the live/completed trace KG labels and system-log behavior.
- Type-only compile unblock:
  - `frontend_v2/src/components/sales-order-create/product-label.ts` was untracked but imported by the dirty sales-order create workspace and blocked the frontend compiler.
  - Added explicit `Record<string, any>` typing for layer template/state access only; no sales behavior was changed by this planner patch.

## 2026-06-29 Completed Trace + Combine Hardening

- Fixed Completed Trace route-span semantics:
  - Completed rows now report `production_trace.current_step_label = "Production complete"`.
  - Template steps after the actual production span are marked `OUT_OF_SCOPE`, not `WAITING`, so the UI renders them as `Not in span` instead of implying a next production step.
  - Completed mode changes the KPI label to `Completion state` and keeps the route traveller focused on the active production span.
- Hardened Combine Orders as a real jumbo-roll batching tool:
  - Candidate grouping now requires the same layer signature, same Product Master, same current route step, and same process.
  - Backend eligibility now blocks:
    - fewer than 2 open jobs,
    - missing Product Master,
    - mixed Product Master,
    - missing target roll width,
    - non-roll-output current steps.
  - Commit endpoint rejects invalid selections with planner-facing messages before stamping `gang_group_id`.
  - Candidate and commit payloads now expose Product Master label/code/name/id, output form, input form, and normalized KG quantity.
- Polished Combine Orders UI labels:
  - Search now includes Product Master.
  - Header/flow copy clearly says same PM + same route step + roll output.
  - Group cards show Product Master, step, output form, width readiness, and first setup blocker.
  - Selection desk uses KG totals and disables the combine button when the selected group is not eligible.

## Backend Logic

- `apps/production/views_planner.py`
  - Adds product master id/code/name/label to sales control-hub rows.
  - Layer labels now preserve variant code and variant name where present.
  - `spec_summary.layer_recipe` includes `variant_code` and `variant_name`.
  - Partial/replan rows now produce `production_trace.job_state = REPLAN_REQUIRED`.
  - Plan Queue classification excludes partial replan rows; Live Production includes partial/replan rows.
  - Production-complete rows are sent to Completed Trace even when parent packing status is not finished.
  - Completed history rows recompute `production_trace` after completed job logs are attached, so expansion has route/job/material detail.
  - `_row_template_steps` now reads explicit `TemplateProcessStep` rows first, preserving route index, sequence, process forms, roll behavior, process transition, default work center, dispatch policy/status, dispatch notes, and roll-handling data such as combine mode and lane count.
  - `_row_production_trace` now carries those route dispatch and roll-handling fields into `production_trace.route_steps`.
  - Completed job trace rows now include job state, status, current step index, and updated timestamp in addition to closed timestamp.
- Combine Orders backend rules:
  - `GET /api/production/planner/gang-candidates/` now groups candidates by layer signature, Product Master, current step index, and process.
  - `POST /api/production/planner/commit-gang/` now enforces same Product Master, same route step/process, roll-output step, and target width before creating a gang group.
  - Product Master identity is read from linked sales line / stock order where present, with metadata fallback for generated stock jobs.
- Existing planner cancel and short-close endpoints remain live:
  - `POST /api/production/planner/control-hub/{order_kind}/{order_id}/cancel/`
  - `POST /api/production/planner/control-hub/{order_kind}/{order_id}/short-close/`
  - Both require a reason and sales line item id for sales-line actions.

## Planner Action Rules

- Cancel line:
  - Available from this control tower only for sales order lines.
  - Requires an audit reason.
  - Backend rejects cancellation when the sales line already has machine activity, job execution logs, scrap logs, downtime logs, or material consumption logs.
  - Stock order cancel is intentionally not exposed here; use the stock order lifecycle action.
- Short-close line:
  - Available from this control tower for sales order lines when unresolved/open/partial quantity exists.
  - Requires an audit reason.
  - Preserves posted production and closes only the unresolved remaining quantity.
  - If production activity exists, short-close is the correct planner override instead of cancel.
  - Stock short-close remains backend-limited to stock orders still in planning-required state.
- WCM machine close:
  - Remains the production job path for actual machine output, scrap, and variance posting.
  - The Live Production action desk now explains that WCM machine close records actual job output, while planner short-close closes the remaining sales-line balance after real production is posted.

## Git Stack Check

- Working directory for this combined planner/sales/template patch set:
  - `/Users/devarshthakkar/Documents/total_blueprint_erp/stock_lifecycle_worktree`
- Remote checked:
  - `origin https://github.com/dev2495/total-blueprint-erp.git`
- Fetched latest remote refs with `git fetch --all --prune` on 2026-06-29.
- Created consolidation branch:
  - `codex/planner-sales-latest-20260629`
- Preserved local planner/sales/template/BOM changes first:
  - `6777163 WIP preserve planner and sales local changes before main sync`
- Merged latest live stack from `origin/main` and resolved conflicts:
  - `483bff4 Merge remote-tracking branch 'origin/main' into codex/planner-sales-latest-20260629`
- Current remote comparison:
  - `HEAD...origin/main`: local is 4 commits ahead and 0 commits behind.
  - Current `HEAD`: `483bff472f4ebca22329c99da6714f668c7ccebd`
  - Current `origin/main`: `ba4ce6c704522c1e306327b0ed1d14135b0e43b5`
- Working tree after the original latest-main merge:
  - Clean at that checkpoint.
- Working tree after later sales/planner addon work:
  - Not clean; additional sales/materials/product-master changes and the final planner live-ledger polish are intentionally present for combined local testing before the next push.
- Merge conflict policy used:
  - Took latest `main` for route/batch execution, WCM/machine, template dispatch, AWS deploy, analytics, inventory, and sales tracker stack changes.
  - Kept local Control Tower order passport, planner trace, scroll/pagination polish, and v2-safe `spec_summary` / `production_trace` / analytics payloads.
  - Combined planner backend route steps so `template_steps` now includes both `main` route graph metadata and local dispatch/roll-handling details.
- Safe next step for sales addon work:
  - Continue from `/Users/devarshthakkar/Documents/total_blueprint_erp/stock_lifecycle_worktree` on branch `codex/planner-sales-latest-20260629`.
  - New sales changes can be added on top of this branch without first pulling `origin/main`; it is already current as of this report.

## Removed V2/V3 Exposure

- Removed sidebar children for Planner Control Tower v2 and v3.
- Removed v2/v3 route registration from navigation validation.
- Removed v2/v3 help route registration.
- Removed local Django comparison routes and deleted local comparison scaffolding.
- Deleted untracked v2/v3 page/component folders from the worktree.

## Verification

- Completed Trace audit/label hardening, 2026-06-30 12:48 IST:
  - Scope: current `/dashboard/planner/control-tower/completed-trace` page only; v2/v3 comparison pages remain out of scope and were not revived.
  - Backend payload now treats closed history rows as audit records instead of live waiting work:
    - stock/packing/planner closures with no WCM job rows return `completion_mode=STOCK_OR_PACKING_CLAIM`, `audit_status=CLAIMED_NO_WCM_LOG`, `remaining_qty=0`, `progress_pct=100`, and route steps marked `CLOSED_BY_STOCK`.
    - WCM-posted closures freeze release gates to `COMPLETED`; stale material/artwork blockers no longer appear as live blockers on completed rows.
    - short-close / variance closures expose `POSTED_WITH_VARIANCE` and `closure_variance_qty` for the UI audit banner.
  - Completed Trace UI now shows usable audit filters and labels:
    - source filters include `Claims`; audit filters include `All audit`, `WCM posted`, `Stock claim`, `Short close`, `Late`, and `Trace gap`.
    - row metadata shows kg first plus pieces, e.g. `8.7 KG · 2,000 pcs`.
    - completed rows badge source/audit path as `STOCK CLAIM`, `WCM POSTED`, or `SHORT CLOSE` instead of generic source-only labels.
    - expanded rows show a closure banner, closed open balance, historical release gates, production traveller, completed job ledger copy, and material issue plan.
    - thickness rendering was cleaned so expanded specs show `12µ+40µ (52µ total)` and readable layer recipes with variant names instead of `12µ+40µ um`.
  - Verification passed:
    - `venv_311/bin/python manage.py test apps.production.tests.test_planner_control_hub_semantics`: passed, 28 tests.
    - `npm run typecheck`: passed.
    - `npm run nav:validate`: passed, 79 sidebar routes and 141 resolver routes.
    - `npm run build`: first run hit stale local `.next/server/pages/_document.js`; moved `.next` aside and reran successfully.
    - `BACKEND_PYTHON=venv_311/bin/python UI_E2E_PYTHON=venv_311/bin/python ./start_all.sh restart`: passed, backend=200 and frontend=200.
    - `BACKEND_PYTHON=venv_311/bin/python UI_E2E_PYTHON=venv_311/bin/python ./start_all.sh verify`: passed deep route/API/asset verification.
    - Direct route probe: `curl -I http://127.0.0.1:3001/dashboard/planner/control-tower/completed-trace` returned `200 OK`.
  - Browser QA:
    - Pre-rebuild authenticated browser QA expanded a completed stock-claim row and verified no horizontal overflow, real kg+pcs row metadata, stock-claim/WCM audit labels, and release gates frozen for closed rows.
    - That browser pass found the redundant `12µ+40µ um` label; the label fix was patched afterward.
    - Post-restart in-app browser reload was blocked by Browser Use URL policy, so final browser recheck after the label patch was not bypassed. Source, build, route, and deep verification are green.
  - AWS go-live:
    - Committed planner patch: `0eab6bf Harden planner completed trace audit UI`.
    - Pushed to GitHub `main`: `e0e7c5c..0eab6bf`.
    - Deployed from detached clean export `/private/tmp/tpp-planner-deploy-0eab6bf` so unstaged sales/logistics/WCM files in `stock_lifecycle_worktree` were not synced.
    - Synced committed source to AWS Lightsail host `3.6.77.159` under `/opt/tpp-erp/app`.
    - AWS Docker build passed for backend, frontend, worker, and beat.
    - AWS backend checks passed: `python manage.py check` and `python manage.py migrate --noinput` with no migrations to apply.
    - AWS containers recreated successfully; backend and frontend reported healthy.
    - Live probes returned `200`: `/api/health/ready/`, `/dashboard/planner/control-tower/command`, `/plan-queue`, `/live-production`, `/completed-trace`, `/stock-intelligence`, and `/gang-builder`.
    - AWS source hash audit matched local committed files for `views_planner.py`, planner semantic tests, `completed-trace-tab.tsx`, `order-passport.tsx`, `planner.ts`, and this report.
    - Post-deploy backend/frontend log tail showed startup and health traffic only; no crash or stack trace was observed.

- Final completed-trace/combine hardening verification, 2026-06-29 20:13 IST:
  - `git fetch --all --prune` plus `git rev-list --left-right --count HEAD...origin/main`: refreshed remote refs and confirmed local is 4 commits ahead, 0 behind `origin/main`.
  - `venv_311/bin/python manage.py test apps.production.tests.test_planner_control_hub_semantics apps.production.tests.test_gang_roll_allocation`: passed, 33 tests.
  - `npm run typecheck`: passed.
  - `npm run nav:validate`: passed, checked 79 sidebar routes and 141 resolver routes.
  - `npm run build`: passed.
  - `./start_all.sh clean-restart`: moved stale `.next`/static assets and started services, but the wrapper was manually interrupted after migration loading stayed quiet; direct health checks then returned `200` for backend and frontend.
  - Direct health checks:
    - `http://127.0.0.1:8000/api/users/csrf/`: `200`
    - `http://127.0.0.1:3001/dashboard/planner/control-tower/command`: `200`
  - `UI_BASE_URL=http://127.0.0.1:3001 UI_E2E_SKIP_BOOTSTRAP=1 PLAYWRIGHT_DISABLE_VIDEO=1 npm run e2e:ui:observations -- tests/e2e/observation/planner-ui-regression.spec.ts`: passed, 7 tests in 1.1 minutes.
  - Browser regression now asserts:
    - Completed Trace expansion shows `Production complete` / `Completion state`.
    - Combine Orders exposes Product Master search and same-PM / roll-output route-step rules.
- Final live-ledger patch verification, 2026-06-29 19:07 IST:
  - `git fetch --all --prune` plus `git rev-list --left-right --count HEAD...origin/main`: refreshed remote refs and confirmed local is 4 commits ahead, 0 behind `origin/main`.
  - `npm run typecheck`: passed.
  - `npm run build`: passed.
  - `BACKEND_PYTHON=venv_311/bin/python UI_E2E_PYTHON=venv_311/bin/python ./start_all.sh clean-restart`: passed backend/frontend health, route probes, asset probes, and deep verification.
  - `UI_BASE_URL=http://127.0.0.1:3001 UI_E2E_SKIP_BOOTSTRAP=1 PLAYWRIGHT_DISABLE_VIDEO=1 npm run e2e:ui:observations -- tests/e2e/observation/planner-ui-regression.spec.ts`: passed, 7 tests.
  - Local test server after restart:
    - Frontend: `http://127.0.0.1:3001`
    - Backend: `http://127.0.0.1:8000`
- Current working tree note:
  - The worktree is not clean because separate sales/materials/product-master work is still present and intended to be combined later.
  - Planner files changed by this final patch are:
    - `frontend_v2/src/components/control-tower/order-passport.tsx`
    - `frontend_v2/src/components/control-tower/live-production-tab/live-production-tab.tsx`
    - `frontend_v2/tests/e2e/observation/planner-ui-regression.spec.ts`
  - One compile-unblock file touched outside planner:
    - `frontend_v2/src/components/sales-order-create/product-label.ts`
- Latest-main sync validation on branch `codex/planner-sales-latest-20260629`:
  - `npm run typecheck`: passed.
  - `npm run nav:validate`: passed, checked 79 sidebar routes and 141 resolver routes.
  - `npm run build`: passed.
  - `venv_311/bin/python manage.py test apps.production.tests.test_planner_control_hub_semantics apps.sales.tests.test_sales_order_cancel_and_ship_to apps.templates.test_route_dispatch`: passed, 41 tests.
  - `BACKEND_PYTHON=venv_311/bin/python UI_E2E_PYTHON=venv_311/bin/python ./start_all.sh clean-restart`: passed backend/frontend health, route probes, asset probes, and deep verification.
  - Direct local Control Tower route probes returned `200` for command, plan queue, live production, and completed trace.
  - `UI_E2E_SKIP_BOOTSTRAP=1 UI_BASE_URL=http://127.0.0.1:3001 PLAYWRIGHT_DISABLE_VIDEO=1 npm run e2e:ui:observations -- tests/e2e/observation/planner-ui-regression.spec.ts`: passed, 7 tests.
- Backend: `venv_311/bin/python manage.py test apps.production.tests.test_planner_control_hub_semantics`
  - Result: passed, 19 tests.
  - Added coverage for dispatch/roll-handling fields in `production_trace.route_steps`.
- Backend recheck after scroll/action polish:
  - `venv_311/bin/python manage.py test apps.production.tests.test_planner_control_hub_semantics`
  - Result: passed, 19 tests.
- Frontend navigation: `npm run nav:validate`
  - Result: passed, checked 71 sidebar routes and 99 resolver routes.
- Frontend typecheck: `npm run typecheck`
  - Result: passed.
  - Note: initial runs appeared hung because stale `tsconfig N.tsbuildinfo` files masked real errors. Cleared stale build-info files, fixed `order-passport` partial trace typing, and reran successfully.
- Frontend production build: `npm run build`
  - Result: passed after adding stable cache-disabling flags to the build script.
  - Build script now runs with `NEXT_DISABLE_CACHE=1` and `DISABLE_NEXT_WEBPACK_PERSISTENT_CACHE=1` to avoid local duplicate `.next/server/* 2` output.
- Browser QA: `UI_E2E_SKIP_BOOTSTRAP=1 UI_BASE_URL=http://127.0.0.1:3001 PLAYWRIGHT_DISABLE_VIDEO=1 npm run e2e:ui:observations -- tests/e2e/observation/planner-ui-regression.spec.ts`
  - Result: passed, 7 tests in 4.3 minutes.
  - Re-run after scroll/action polish on rebuilt production stack: passed, 7 tests in 17.4 seconds.
  - Verified command, plan queue, live production, completed trace, combine orders, stock launcher, stock intelligence, and sales create smoke surfaces.
  - Live Production assertion now checks `Production traveller`, `Live job ledger`, and `Material issue plan`.
  - Completed Trace assertion expands a closed order row and checks `Production traveller` plus completed job ledger empty/loaded state.
  - No horizontal overflow detected by the regression helper.
- Full bootstrap observation run note:
  - The normal non-skip Playwright run restarted the stack and passed route/asset/deep verification, but failed before browser tests during acceptance cleanup because an existing `production_batches` row references a `sales_order_items` row targeted for deletion.
  - Error: `production_batches_sales_order_item_id_923a66f7_fk_sales_ord` foreign key violation in `run_tagged_acceptance._cleanup_prior_test_rows`.
  - This is an existing acceptance-data cleanup issue, not a planner control tower page failure. The planner browser regression was therefore rerun with `UI_E2E_SKIP_BOOTSTRAP=1` against the already-clean local stack and passed.
- Manual/browser route QA remains valid against real backend data.
  - `/dashboard/planner/control-tower/command`: loaded, no horizontal overflow.
  - `/dashboard/planner/control-tower/plan-queue`: loaded, passport chips visible, no horizontal overflow.
  - `/dashboard/planner/control-tower/live-production`: loaded, FG/WIP/Fresh source columns removed, production traveller and job/material ledgers visible, no horizontal overflow.
  - `/dashboard/planner/control-tower/completed-trace`: loaded, completed row expanded with completed-mode production traveller and job/material trace sections, no horizontal overflow.
  - `/dashboard/planner/control-tower/stock-intelligence`: loaded, planner stock-pressure cards visible, no horizontal overflow.
- Screenshot evidence:
  - `.runtime/ui-e2e/manual-planner-current/command.png`
  - `.runtime/ui-e2e/manual-planner-current/plan-queue.png`
  - `.runtime/ui-e2e/manual-planner-current/live-production.png`
  - `.runtime/ui-e2e/manual-planner-current/completed-trace.png`
  - `.runtime/ui-e2e/manual-planner-current/stock-intelligence.png`

## Local Test Server

- Backend is running on `http://127.0.0.1:8000`.
- Frontend is running on `http://127.0.0.1:3001` for manual testing.
- 2026-06-29 15:22 IST recovery: the blank browser page was traced to stale Next route chunks. The HTML for `/dashboard/planner/control-tower/command` was returning `200`, but `/_next/static/chunks/app/(dashboard)/dashboard/planner/control-tower/command/page.js` was missing before the clean frontend restart.
- Current server state after recovery:
  - Backend: `Python 3.11` runserver on `8000`.
  - Frontend: Next production server on `3001`.
  - Final restart command used `BACKEND_PYTHON=venv_311/bin/python UI_E2E_PYTHON=venv_311/bin/python ./start_all.sh clean-restart` so the script did not pick the incompatible `.venv` Python 3.14 runtime.
  - The clean restart moved stale `.next` output aside, rebuilt the production frontend, restarted both services, and passed `start_all.sh` deep verification.
  - Authenticated browser probe reached `/dashboard/planner/control-tower/command`, rendered planner content, and recorded no failed planner API or Next chunk requests.
- Current route probes returned `200 OK` for:
  - `/dashboard/planner/control-tower/command`
  - `/dashboard/planner/control-tower/plan-queue`
  - `/dashboard/planner/control-tower/live-production`
  - `/dashboard/planner/control-tower/completed-trace`
  - `/dashboard/planner/control-tower/stock-intelligence`
  - `/dashboard/planner/control-tower/gang-builder`
- Final post-restart probes returned `200 OK` for command, live production, completed trace, and backend health.

## Repeated Error Handling

- Repeated `tsc --noEmit` stall:
  - Researched and applied the most efficient local fixes: remove stale incremental build-info, clear `.next`, disable persistent Next cache, isolate changed TSX parsing, and then fix surfaced strict typing errors.
  - Chosen fix: delete stale `tsconfig*.tsbuildinfo`, type `production_trace` as `Partial<PlannerProductionTrace>`, and keep cache-disabled build flags.
- Repeated Next build artifact instability:
  - Cause observed locally: duplicate `.next/server/* 2` output and transient missing trace/page files.
  - Chosen fix: make the build script run with `NEXT_DISABLE_CACHE=1` and `DISABLE_NEXT_WEBPACK_PERSISTENT_CACHE=1`, then rerun clean build successfully.
- Repeated local `Watchpack Error (watcher): EMFILE: too many open files, watch` during frontend dev startup:
  - Considered fixes: raise the process file limit, switch Watchpack/Chokidar to polling, ignore large watched directories, prune stale `.next` trees, or patch watcher configuration.
  - Observation: shell `ulimit -n` was already high, so raising the file limit was not the efficient fix.
  - Chosen fix: restart only the frontend with `WATCHPACK_POLLING=true` and `CHOKIDAR_USEPOLLING=true`; this removed the repeated watcher errors and kept the route chunks available.
- Post-build dev-server 500 after `npm run build`:
  - Cause observed locally: the dev server expected development `.next/server/app/.../page.js` files after the production build rewrote `.next`, causing `Expected clientReferenceManifest` and `ENOENT page.js` errors.
  - Chosen fix: run a clean production restart with `BACKEND_PYTHON=venv_311/bin/python`; final production route probes returned `200`.

## Known Non-Goals

- No v2/v3 comparison page is retained.
- No fake fallback data was added.
- Stock-order cancel remains delegated to the stock order lifecycle action; current Control Hub cancel is sales-line scoped.

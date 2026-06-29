# Planner Control Tower Current Upgrade Report

Date: 2026-06-29

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
  - `839ef2a Merge remote-tracking branch 'origin/main' into codex/planner-sales-latest-20260629`
- Current remote comparison:
  - `HEAD...origin/main`: local is 4 commits ahead and 0 commits behind.
  - Current `HEAD`: `839ef2a1aba71410e9123ae01d58d841c10ee5b4`
  - Current `origin/main`: `ba4ce6c704522c1e306327b0ed1d14135b0e43b5`
- Working tree after merge:
  - Clean.
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

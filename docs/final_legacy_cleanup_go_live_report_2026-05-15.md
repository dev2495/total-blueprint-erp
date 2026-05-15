# Final legacy cleanup and go-live verification

Date: 2026-05-15
Worktree: `/Users/devarshthakkar/local_repos/erp total/.claude/worktrees/optimistic-borg-130fe2`
Status: local only, no commit

## Result

The current local system is green on the final Product Master / Sales / Inventory V36 model. Legacy UI pages were removed from the app surface and the current server is running the production frontend build on port `3001` with a Gunicorn backend on port `8000`.

## Removed legacy UI pages

Removed old UI route files for:

- Inventory: `roll-explorer`, legacy stock, bulk, GRN, opening stock, packaging, stock card, stock count, stock lifecycle, year close, FY correction.
- Planner: old planner SKU catalog and old stock-order create page.
- Sales: old sales SKU catalog page.
- Sales components: old `components/sales/new/*` workspace files.
- Inactive Pages Router archives: `frontend_v2/src/pages_legacy/*` and `frontend_v2/src/pages.disabled/*`.

Current replacement surfaces kept and verified:

- `/master/products`
- `/sales/orders/create`
- `/sales/orders/new`
- `/production/planner`
- `/production/planner/stock-launcher`
- `/inventory/rolls-v36`
- `/inventory/bulk-v36`
- `/inventory/packaging-v36`
- `/inventory/period`
- `/inventory/grn-v36`
- `/inventory/addons-v36`
- `/inventory/inter-plant-v36`
- `/inventory/traceability-v36`

## Fixes made while verifying

- Prod-mode `start_all.sh` now boots the backend through Gunicorn by default instead of Django `runserver`; dev mode on macOS can still use `runserver`.
- Release-green runner now explicitly uses Gunicorn with two sync workers to match Render-style WSGI behavior and avoid local Postgres connection-slot spikes.
- `ExecutionService.get_step_execution_profile()` is race-safe if a test cleanup removes a job while a list serializer is resolving execution profile data.
- Packaging V36 quantity display now respects each material UOM precision, so KG stock like `1.5 KG` is not rounded to `2 KG`.
- Help/docs/tests/scripts were retargeted from deleted legacy routes to the current V36/current routes.
- Repeat-order Playwright gate now validates the actual Quick Start contract: the API proves the seeded repeat candidate exists, and the visible customer shortcut must stage a cart line. This removes a false failure caused by accumulated local recent-order data choosing a different valid latest order first.

## Repeated 500 root cause

The repeated full-run error was not a missing UI page. Backend logs showed:

`psycopg2.OperationalError: remaining connection slots are reserved for non-replication superuser connections`

Options considered:

- Close stale/idle database connections before test phases.
- Force local prod verification to use Gunicorn instead of threaded Django `runserver`.
- Reduce local WSGI worker concurrency.
- Increase local PostgreSQL `max_connections`.
- Add retries around frontend route tests.

Chosen fix: use Gunicorn for prod-mode local verification and keep the existing idle-connection trim. This matches Render more closely and fixes the cause instead of masking 500 responses.

## Verification

Passed:

- `npm run typecheck`
- `npm run help:validate`
- `./start_all.sh clean-restart` in prod mode
- Deep route/API/static asset verification from `start_all.sh`
- Targeted prod rerun of the five previously failing mobile responsive batches: `5 passed`
- Exact final release gate after archive-page deletion and repeat-order stabilization: `npm run e2e:ui:green`

Final release summary:

- Gate: `218 passed`
- Mutations: `13 passed`
- Observations: `8 passed`
- Total: `239 passed, 0 failed, 0 skipped`
- Generated at: `2026-05-15T20:10:50.757Z`

Runtime after verification:

- Frontend: `http://127.0.0.1:3001/login`
- Backend health: `http://127.0.0.1:8000/api/health/`
- Frontend mode: `prod`
- Backend mode: Gunicorn `25.3.0`, 2 sync workers

Final backend error scan:

- No `ERROR`
- No `Internal Server Error`
- No `remaining connection slots`
- No `ProductionJob matching query does not exist`
- No `OperationalError`

## Stale reference scan

No legacy UI page references remain in app/test/help route surfaces. Remaining hits are backend compatibility API endpoints only:

- `/api/sales/sku-catalog/`
- `/api/inventory/opening-stock/...`

These are not visible legacy pages.

## Go-live note

The local system is ready for Render deployment from this worktree once the owner-controlled Render secrets, database URL, allowed hosts, CORS origins, and production credentials are set outside the repo.

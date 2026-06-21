# Production Data Truth Report - 2026-06-21

## Scope

This pass reviewed the high-visibility dashboard and inventory/planner surfaces after the AWS migration:

- Owner / Executive Control Centre
- Sales, Planner, Logistics, Work Centre, and Inventory dashboards
- Planner Control Tower: Live Production, Completed Trace, Stock Intelligence
- Inventory workspaces: rolls, bulk, packaging, addons, GRN history
- Admin role-preview behavior

The goal was to stop stale, fallback, synthetic, or partial payloads from looking like real business numbers.

## Root Cause

Several pages rendered default API objects as valid metrics. When a backend feed was partial, timed out, or lacked actual costing rows, the UI converted missing values to `0`, synthetic trends, or generic placeholder text. That created misleading dashboards such as zero margin, zero production health, extreme MRP pressure from partial inputs, and charts that looked empty without saying whether the data feed was unavailable or genuinely empty.

## Fixes Applied

- Analytics API payloads now include `generated_at` and `data_quality` readiness metadata for sales, planner, WCM, and owner/control-tower stats.
- Owner dashboard no longer shows profit, margin, FPY, material discipline, ink control, or procurement vendor rankings as real values when the source feed or actual costing data is not ready.
- Sales dashboard no longer uses a hard-coded `10,000 KG` monthly target. Sales target progress is now intentionally pending until a real configured target exists.
- Planner, logistics, and WCM dashboards now pause KPI cards instead of showing fallback zeros when their live feed is unavailable.
- Stock Intelligence now requires control-hub demand, planner stock, and planner dashboard source-mix data together before calculating coverage, MRP pressure, packaging, or POD signals.
- Inventory dashboard empty chart states now distinguish `Health payload unavailable` from a real `No stock volume` state.
- Inventory workspace sparkline placeholders were removed from rolls, bulk, packaging, addons, and GRN history so they do not imply unverified trends.
- Completed Trace now defaults to an all-job ledger, supports a 10-year audit window, and shows `shown of total` counts from the backend.
- Live Production now fetches wider active sets, keeps DB-wide header counts authoritative, and labels route-board display scope instead of silently hiding active groups.
- Shared KPI grid formatter now accepts nullable backend values and renders them as pending instead of coercing them to zero.

## Intentional Behavior

- Admin role preview remains gated by `NEXT_PUBLIC_ALLOW_ROLE_PREVIEW=true`. This is intentional production security behavior; without that flag the frontend removes stale `x_role_override` cookies and does not send role override headers.
- Owner margin/profit can show pending even when revenue exists. That is correct when actual costing rows are not posted yet.
- Sales target progress can show pending even when order revenue exists. That is correct until a business target is configured.
- Live Production route board may cap rendered rows for browser performance, but the header KPIs remain database-wide and the UI says how many active groups are shown.

## Verification

- `git diff --check` passed.
- `frontend_v2 npm run typecheck` passed.
- `frontend_v2 npm run build` passed.
- `.venv/bin/python manage.py check` passed.
- `.venv/bin/python manage.py test apps.analytics.tests.test_trace_lookup apps.analytics.tests.test_operational_logs apps.production.tests.test_planner_control_hub_semantics --keepdb` passed: 28 tests.

## Production QA Targets

After deploy, verify:

- `/dashboard/owner`
- `/dashboard/sales`
- `/dashboard/planner`
- `/dashboard/logistics`
- `/dashboard/work-center`
- `/dashboard/inventory`
- `/dashboard/planner/control-tower/live-production`
- `/dashboard/planner/control-tower/completed-trace`
- `/dashboard/planner/control-tower/stock-intelligence`
- `/inventory`, `/inventory/rolls`, `/inventory/bulk`, `/inventory/packaging`, `/inventory/grn-history`


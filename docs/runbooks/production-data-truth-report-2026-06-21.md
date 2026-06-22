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
- Legacy `/analytics/kpi` now redirects to the live `/analytics/kpis` surface instead of rendering the old hard-coded 78%/92%/2.3% placeholder KPI board.
- Owner KPI cards and detailed financial breakdown now render `Pending` when actual costing, material postings, ink postings, shift rows, or trend rows are missing instead of formatting missing values as zero.
- Analytics report empty states now reference live job/sales/inventory/dispatch events, not seeded runner telemetry.
- Inventory home movement pulse no longer draws visual-only in/out/net stock trends; it explicitly waits for an audited movement ledger feed while preserving the real current stock totals and location/detail views.
- Planner heatmap now reads only live work-center capacity rows. Fake ambient temperature, humidity, airflow, vibration, aux-zone tiles, static contention alerts, fake OEE, and fake throughput cards were removed.
- Inventory workspace page backgrounds and empty heatmap cells now use theme tokens so light/dark mode does not hide or wash out data.
- Inventory home reservation footer now uses live `reserved_qty` and `free_qty` fields from the snapshot instead of estimated reservation/free splits.
- MRP Center now excludes historical outlier runs from default trend/dashboard selection, labels those runs as audit-only, and disables draft actions while an outlier is selected.
- Completed Trace now loads 100 rows per page and labels page-derived charts as loaded-row analytics when the backend ledger has more rows than currently shown.

## Intentional Behavior

- Admin role preview is visible to owner/admin/superuser sessions. Backend `ALLOW_ROLE_OVERRIDE` still controls whether the override header is honored server-side and audited.
- Owner margin/profit can show pending even when revenue exists. That is correct when actual costing rows are not posted yet.
- Sales target progress can show pending even when order revenue exists. That is correct until a business target is configured.
- Live Production route board may cap rendered rows for browser performance, but the header KPIs remain database-wide and the UI says how many active groups are shown.
- Factory heatmap does not show environmental telemetry unless the backend starts sending real sensor data. For now it is intentionally a capacity/work-center load view.

## Verification

- `git diff --check` passed.
- `frontend_v2 npm run typecheck` passed.
- `frontend_v2 npm run build` passed.
- `.venv/bin/python manage.py check` passed.
- `.venv/bin/python manage.py test apps.analytics.tests.test_trace_lookup apps.analytics.tests.test_operational_logs apps.production.tests.test_planner_control_hub_semantics apps.mrp.tests apps.sales.tests.test_quotation_module --keepdb` passed: 50 tests.
- Authenticated DRF API smoke passed for analytics/control-tower, sales dashboard, planner dashboard, WCM dashboard, dashboard summary, KPI, completed trace, live summary, control hub, capacity, inventory snapshot, rolls, bulk, packaging, addons, GRN history, locations, audit stock card, closing preview, reservations, MRP requirements, and MRP suggestions.
- Superseded by the fuller 2026-06-22 go-live report: `docs/runbooks/production-data-truth-go-live-report-2026-06-22.md`.

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

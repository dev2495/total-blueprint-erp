# Production Data Truth Go-Live Report - 2026-06-22

## Objective

Make the AWS production ERP show only real, actionable numbers across dashboards, planner control tower, and inventory workspaces. Missing source data must render as pending, unavailable, or specifically empty; it must not be converted into fake zeros, old demo charts, estimated splits, or unclear placeholder labels.

## Surfaces Covered

- Owner and executive analytics dashboards.
- Analytics hub, KPI, costing, MRP, reports, scrap, and process-rate pages.
- Planner Control Tower command, live production, completed trace, stock intelligence, and plan queue states.
- Inventory home and workspaces for rolls, bulk, packaging, addons, GRN history, movements, and traceability.
- Planner heatmap and capacity view.
- Admin role-preview and role override plumbing.

## Root Causes Fixed

- Several frontend cards coerced missing backend fields to `0`, which made partial feeds look like real zero performance.
- Old dashboard components still contained static KPI boards, seeded telemetry wording, or visual-only trend placeholders.
- MRP trend selection included historical outlier runs, so old audit runs could dominate the live planning story.
- Completed Trace showed a small page of rows without clearly saying when charts were based on loaded rows versus the full ledger.
- Inventory splits used vague labels like `Unknown`, `No data`, and estimated reservation/free values.
- Stock Intelligence and source-mix cards used infinite or zero coverage when there was no demand, instead of saying `No demand`.
- Role preview was hidden by frontend environment gates even when the authenticated user had admin/owner authority.

## Changes Applied

- Added backend data-quality metadata and pending states for analytics/control-tower payloads.
- Owner dashboard now shows `Pending` when costing, material postings, ink postings, shift rows, or trend rows are not available.
- Owner inventory mix now includes real bulk KG, WIP roll KG, finished roll KG, and packaging base UOM buckets without folding packaging units into KG.
- Legacy `/analytics/kpi` now redirects to the live `/analytics/kpis` page instead of rendering the old hard-coded KPI board.
- Analytics report copy now references live job, sales, inventory, and dispatch events rather than seeded runner telemetry.
- MRP Center excludes extreme historical outlier runs from the default live trend, labels outliers as audit-only, and disables draft actions while an outlier is selected.
- Planner heatmap now renders live work-center capacity only; fake environment tiles and static OEE/throughput cards were removed.
- Completed Trace now loads 100 rows, uses the backend total count, and labels page-derived charts as loaded-row analytics when the ledger is larger than the visible rows.
- Stock Intelligence now separates linked stock from unlinked inventory, uses `No demand` instead of infinity, and flags missing product/template links.
- Command/source-mix coverage cards now show `No demand` when required KG is zero.
- Inventory home removed visual-only movement sparklines and uses live `reserved_qty` / `free_qty` fields.
- Inventory workspace split, heatmap, pulse, movement, and traceability empty states now describe the exact missing condition.
- Traceability now says `Material not linked` when a roll has no material name.
- Admin/owner role preview is visible client-side; backend `ALLOW_ROLE_OVERRIDE` remains the server authority for whether override headers are honored.

## Intentional Data States

- `Pending` is correct when revenue exists but actual costing/material/ink postings have not been posted.
- `No demand` is correct when stock exists but no active demand is present for that pool.
- `Material not linked` or `product/template link missing` is a real master-data issue, not a display fallback.
- Live Production can cap rendered groups for browser performance, but header counts remain backend-wide.
- Environmental telemetry remains absent until a real sensor feed exists.

## Verification Evidence

### Local Verification

- `git diff --check`: passed.
- `.venv/bin/python manage.py check`: passed with no system-check issues.
- `.venv/bin/python manage.py test apps.analytics.tests.test_trace_lookup apps.analytics.tests.test_operational_logs apps.production.tests.test_planner_control_hub_semantics apps.mrp.tests apps.sales.tests.test_quotation_module --keepdb`: passed, 50 tests.
- `frontend_v2 npm run typecheck`: passed. Theme-token guard, route typegen, and `tsc --noEmit` passed.
- `frontend_v2 npm run build`: passed. Next.js 15.5.10 production build completed successfully.
- Authenticated DRF API smoke passed for analytics/control-tower, sales dashboard, planner dashboard, WCM dashboard, dashboard summary, KPI, completed trace, live summary, control hub, capacity, inventory snapshot, rolls, bulk, packaging, addons, GRN history, locations, audit stock card, closing preview, reservations, MRP requirements, and MRP suggestions.
- Local `/api/mrp/plans/latest/` returned 404 because the local database has no completed latest MRP plan. That is a data-state difference, not an endpoint regression; production must be checked after deploy where live MRP plans exist.

### Production Verification

To be completed after AWS backup, deploy, route smoke, authenticated production API smoke, and backend/frontend/worker log review.

## Production QA Routes

- `/dashboard/owner`
- `/dashboard/sales`
- `/dashboard/planner`
- `/dashboard/logistics`
- `/dashboard/work-center`
- `/dashboard/inventory`
- `/dashboard/planner/control-tower/live-production`
- `/dashboard/planner/control-tower/completed-trace`
- `/dashboard/planner/control-tower/stock-intelligence`
- `/inventory`
- `/inventory/rolls`
- `/inventory/bulk`
- `/inventory/packaging`
- `/inventory/grn-history`
- `/inventory/movements`
- `/inventory/traceability`
- `/analytics`
- `/analytics/kpi`
- `/analytics/kpis`
- `/analytics/mrp`
- `/analytics/costing`
- `/analytics/reports`
- `/analytics/scrap`
- `/analytics/process-rates`
- `/production/planner/heatmap`

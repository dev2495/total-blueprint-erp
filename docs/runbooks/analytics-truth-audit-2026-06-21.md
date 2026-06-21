# Analytics Truth Audit - 21/06/26

## Scope

This audit covers the screens where users reported stale, wrong, or non-actionable numbers:

- Planner Control Tower: Live Production
- Planner Control Tower: Completed Trace
- Analytics KPI dashboard
- Owner dashboard
- MRP analytics and MRP requirement explosion
- Admin role preview / role switcher visibility

## Root Causes Found

1. Completed Trace was reading `control-hub` order history. That endpoint is intentionally sampled and order-focused, so it could not show every completed production job.
2. Live Production headline KPIs were derived from a bounded job list. If the first 50 jobs did not include all states, the hero numbers were partial.
3. MRP treated count-only packaging/addon BOM rows as KG demand when `weight_kg` was missing. This created false packing shortages.
4. MRP also double-scaled materialized packaging rows. Current order flows save full-order `stock_qty` / `weight_kg` on packaging BOM rows, but MRP multiplied those totals by the SO scaling factor again.
5. Owner and KPI dashboards showed sales-line booked value beside profit/margin fields even when no actual costing rows existed.
6. Inventory value used a hardcoded estimated rate. That made stock value look final even though live material rates were not attached.
7. Material consumption cards showed zero issue/return/consumed numbers as normal performance even when no actual material postings existed.
8. Admin role switcher is gated by production security settings. It is not a UI disappearance; hosted production disables unsafe role override unless an explicit secure preview mechanism is implemented.

## Patch Direction

### Planner Completed Trace

- Added a dedicated completed-job ledger endpoint: `/api/production/planner/completed-job-trace/`.
- The page now reads paginated completed `ProductionJob` rows, not sampled order history.
- KPI cards now say jobs closed / produced KG / variance jobs.
- CSV export now exports job facts: job number, order number, produced quantity, planned quantity, completed time, and cycle time.

### Planner Live Production

- Added a DB-wide live summary endpoint: `/api/production/planner/live-summary/`.
- The hero numbers now use exact aggregate counts for executing, released, waiting, paused, active KG, completed 24h, variance, and total in flight.
- The visual rails remain bounded for speed, but the headline counts are no longer sampled.

### MRP Requirement Explosion

- Count-only packaging and addon rows are no longer treated as KG.
- Rows without `weight_kg` are skipped for material-demand KG until a real conversion exists.
- Materialized packaging rows now use their saved order-scope `stock_qty`, or `count_qty * unit_base_qty`, instead of multiplying `weight_kg` by the order scaling factor again.
- Zero/negative demand rows are ignored.
- This fixes the false multi-crore KG packaging requirement symptom.

### Owner / KPI Dashboards

- Revenue is now labeled as `Booked Order Value`.
- Profit is now labeled as `Absorbed Margin` and shows a costing-pending state when actual order costs are missing.
- Inventory is shown as `Inventory On Hand` in KG until live material rates are attached.
- Material Control now exposes actual-posting coverage so zero consumption is not mistaken for real discipline.

## Remaining Business Truth

- If actual order costing is not posted, true gross margin and net margin are not available. The UI now says that clearly instead of showing false precision.
- If material issue/return/consumption postings are not entered, material discipline cannot be final. The UI now reports posting coverage.
- If MRP rows need count-to-KG conversion for packing materials, the master/BOM data must carry `weight_kg` or a proper conversion rule. The patch prevents false demand; it does not invent missing conversions.
- Production role impersonation should not be re-enabled as a raw role switcher. A safe solution would be a time-boxed, audited admin preview mode with explicit permissions.

## Verification Required After Deploy

1. Run Django checks and frontend build.
2. Deploy backend and frontend together.
3. Run a fresh MRP plan after deploy so the old false plan is replaced.
4. Verify:
   - Completed Trace count matches completed jobs in the selected period.
   - Live Production hero counts match DB-wide job-state counts.
   - Owner dashboard shows booked value and costing-pending messaging if cost rows are absent.
   - KPI dashboard inventory card shows KG on hand, not hardcoded rupee value.
   - MRP top requirements no longer include count-only packaging quantities as KG.
   - Materialized packaging rows such as PP bag appear at order-scope stock quantity, not order quantity multiplied again.

## Second Pass - Dashboard Data Truth

Additional pages reviewed after the first deploy:

- Planner dashboard
- Engineering dashboard
- Analytics report tab shell
- Inventory and scrap report valuation fields

### Extra Root Causes Found

1. Planner dashboard stock-mix pie used `0.0001` fallback values to force visible slices. This could show a mix even when the real source pool value was zero.
2. Engineering dashboard was still a demo shell: pending artwork count, cylinder maintenance count, routing approvals, active BOM count, approval rows, customer name, and catalog-health percentages were hardcoded.
3. Inventory report valuation used `MaterialCostSnapshot` when available but silently fell back to a default `250/kg` rate when material rates were missing.
4. Scrap report cost used the same kind of default cost fallback, making scrap value look real even without cost snapshots.
5. The inventory report degraded/error payload returned `estimated_value: 0`, which looked like a real zero valuation instead of an unavailable valuation.

### Extra Patches Applied

- Planner stock mix now uses exact real values only. If every pool is zero, it shows a neutral empty state instead of a fabricated pie.
- Engineering dashboard now fetches live rows from:
  - `/api/artwork/artworks/`
  - `/api/tooling/cylinders/`
  - `/api/templates/`
  - `/api/routing/rules/`
- Engineering KPIs now show real pending artwork, cylinder attention, templates-to-finish, live template, active route, artwork cylinder-readiness, and route coverage counts.
- Engineering approval queue now lists real artwork/template records or a real empty state. No sample customer/spec rows remain.
- Inventory report valuation now exposes rate coverage:
  - `estimated_value` is only populated for rate-backed stock.
  - `valuation_rate_coverage_pct` tells users how much stock weight has cost rates.
  - missing-rate weight and item counts are included for follow-up.
- Scrap report cost now becomes unavailable when cost snapshots are missing; it no longer multiplies scrap by a default rate.
- Inventory report degraded payload now returns valuation as unavailable with zero coverage fields, not a fake zero-value stock estimate.

### Current Product Truth

- Booked sales can appear immediately because sales order data exists.
- Profit, margin, material cost, scrap cost, and stock value are final only when actual costing/material-rate records exist.
- Dashboards should now show pending/unavailable coverage states for missing costing data instead of silently presenting default rates as truth.
- Role switcher remains intentionally disabled in production unless an audited admin preview mode is enabled.

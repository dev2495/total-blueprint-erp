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

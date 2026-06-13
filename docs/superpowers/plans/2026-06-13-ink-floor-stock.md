# Ink Floor Stock And Reconciliation Plan

## Final Operating Model

Ink is not an execution-gate material. It is issued to a floor location, counted there, returned from there, or converted into mix ink. Artwork and BOM keep only theoretical total ink usage for comparison.

The invariant is:

1. Artwork filters by printing compatibility only: `print_type` and `substrate_mode`.
2. Artwork stores free-text colors and one total `ink_gsm_total`.
3. Artwork does not map colors to `InkMaterial`.
4. BOM shows theoretical total ink kg, not color-wise ink master rows.
5. Production execution does not allocate, cap, auto-consume, or require ink completion.
6. Ink floor movements are open-ended operational events with timestamp, shift, plant, and location metadata.
7. A count window is the reconciliation boundary: opening stock + issues - returns - closing count = actual consumed.
8. Actual consumed is allocated back to jobs/orders by theory share for comparison, never treated as direct per-job truth.

## Machine And Shift Rules

Ink must be excluded from machine-level step targets and output caps. Printing output should continue to be governed by input rolls and normal tolerance. If retained ink weight becomes a required physical allowance later, add a small theory-derived allowance to output validation; do not use issued ink as a cap.

Shift is a reporting label on issue, return, mix, count, and reconciliation. It is not a guard by itself. The guard is a locked count window for plant + floor location and optionally machine/work-center. Backdated ink movements inside a locked window must be rejected or flagged.

## Frontend Product Thesis

Visual thesis: a restrained factory stock-control workspace, dense shift/location tables, compact filters, neutral surfaces, and one ink/amber accent only for variance and action state.

Content plan: one ink floor workspace with issue, return/mix, stock count, and reconciliation tabs; each tab shows plant, floor location, shift/date, material, quantity, and reference. The reconciliation view shows theory, actual, variance kg, and variance percent by order/job.

Interaction thesis: use tabs and segmented controls, sticky filters, searchable material pickers, inline drawers/dialogs for issue/return/count, and no explanatory marketing copy.

## Backend Tasks

1. Add focused failing tests for artwork accepting free-text colors without ink mapping.
2. Add focused failing tests that BOM theory emits only total ink usage and production requirement generation excludes ink from execution material requirements.
3. Add focused failing tests for ink floor issue, return, mix return, count, and reconciliation math.
4. Extend `InkMaterial` with mix metadata while preserving existing base/color uniqueness.
5. Add ink floor models in inventory:
   - session/window with plant, location, optional machine/work center fields, shift date/code, opened/closed/counted timestamps, status, notes.
   - movement rows for issue, return, mix return, and count adjustment with source/destination location, material, target material, qty kg, event time, shift metadata, and references.
   - count lines with system qty, counted qty, variance qty, and posted stock transaction references.
6. Add inventory service functions:
   - issue: transfer bulk from store to floor.
   - return: transfer bulk from floor to store.
   - mix return: consume source floor ink and add target mix ink to the selected destination.
   - count: snapshot system qty, post adjustment to counted qty, lock/post the count window.
   - reconcile: compute opening, issue, return, closing, actual consumed, theory consumed, and allocated actual by theory share.
7. Add DRF serializers/views/routes under `/api/inventory/ink-floor/`.
8. Remove artwork-to-ink-master validation and representation fields from the artwork contract path.
9. Change BOM resolver to emit one theoretical ink row from `ink_gsm_total` with no ink master material id.
10. Change production requirement calculation and completion reconciliation to ignore ink rows for gates, caps, and auto-consumption.

## Frontend Tasks

1. Update artwork dialog/service types to remove ink master mapping UI and keep total ink GSM plus free-text color names.
2. Extend ink master form/table with mix metadata.
3. Add `frontend_v2/src/services/ink-floor.ts`.
4. Add `/inventory/ink-floor` workspace for issue, return/mix, count, and reconciliation tabs.
5. Add route registry/help/navigation entries consistent with existing inventory pages.
6. Link posted ink floor counts and movements into Stock Lifecycle period proof, alongside EOD packing.
7. Keep the page operational: dense tables, compact controls, clear variance numbers, no hero content.

## Verification Commands

1. `.venv/bin/python manage.py check`
2. `.venv/bin/python manage.py makemigrations --check --dry-run`
3. `.venv/bin/python manage.py test --keepdb apps.artwork.tests apps.sales.tests.test_printing_snapshot_contract apps.sales.tests.test_artwork_product_validation apps.sales.tests.test_axis_resolver_defer_artwork apps.sales.tests.test_product_config_order apps.sales.tests.test_all_extruded_artwork_flow apps.production.tests.test_planner_assign_artwork_gate apps.production.tests.test_ink_theory_not_execution_gate apps.inventory.tests.test_ink_floor_stock apps.production.tests.test_material_consumption_strictness apps.production.tests.test_roll_assignment_fallback`
4. `npm --prefix frontend_v2 run typecheck`
5. `npm --prefix frontend_v2 run nav:validate`
6. `npm --prefix frontend_v2 run lint`
7. `.venv/bin/python manage.py test --keepdb`
8. `npm --prefix frontend_v2 run build`
9. `git -C /Users/devarshthakkar/Documents/total_blueprint_erp/stock_lifecycle_worktree diff --check`
10. Active-code stale symbol scan for old ink mapping/remix fields outside tests/migrations.

If the same failure occurs twice, stop retrying locally, research 3-5 fixes, choose the smallest correct one, and implement it.

## Implementation Status 2026-06-13

Implemented:

1. Removed active artwork-to-ink-master mapping and per-color ink GSM split fields from the artwork model, serializer, contract, sales snapshot path, BOM resolver path, physics signature, frontend types, and artwork UI.
2. Added migrations to drop `Artwork.color_mapping`, `Artwork.ink_gsm_split_mode`, `Artwork.ink_gsm_color_percentages`, and `Artwork.ink_gsm_by_color`.
3. Changed theoretical ink BOM output to one `INK-THEORY` row with `material_id = None`, `color = TOTAL`, and total GSM/weight only.
4. Removed ink from production execution material gating, allocation caps, strict material actual reconciliation, and old `InkBlendTransaction` mix-return logic.
5. Deleted the `InkBlendTransaction` model and migration path; mix/return behavior now belongs to inventory ink floor stock events.
6. Added ink floor inventory models, serializers, services, tests, routes, and frontend workspace for issue, return, mix return, count, and reconciliation.
7. Added ink mix metadata on ink masters and exposed it in master-data/frontend ink pages.
8. Added `/inventory/ink-floor` navigation and route registry entries.
9. Added Stock Lifecycle proof for posted ink floor counts and same-day issue/return/mix movements, with a direct ink floor drill-in.
10. Cleaned seed/reset/acceptance helpers so current runtime code does not recreate the old mapping model.
11. Removed stale machine-terminal ink return/remix controls and stale analytics timeline references to the deleted `InkBlendTransaction` model.
12. Updated the production material-actual regression tests so non-ink material actuals still reconcile normally and ink rows are explicitly ignored by machine actual reconciliation.

Verification evidence:

1. `.venv/bin/python manage.py check` passed.
2. `.venv/bin/python manage.py makemigrations --check --dry-run` passed with `No changes detected`.
3. Focused affected Django suite passed: 97 tests.
4. `npm --prefix frontend_v2 run typecheck` passed.
5. `npm --prefix frontend_v2 run nav:validate` passed.
6. `npm --prefix frontend_v2 run lint` passed after moving the script from deprecated `next lint` to direct ESLint over `src`; it exits 0 with one existing `src/app/layout.tsx` custom-font warning.
7. `.venv/bin/python manage.py test --keepdb apps.production.tests_operator_material_actuals` passed: 5 tests.
8. `.venv/bin/python manage.py test --keepdb` passed: 717 tests, 3 skipped.
9. `npm --prefix frontend_v2 run build` passed and includes `/inventory/ink-floor` plus `/inventory/stock-lifecycle` in the built route list.
10. `git -C /Users/devarshthakkar/Documents/total_blueprint_erp/stock_lifecycle_worktree diff --check` passed.
11. Active-code stale symbol scan returned no old ink mapping/remix symbols outside tests/migrations.

## Completion Audit

The implementation is complete only when:

1. Artwork approval no longer requires `InkMaterial` mapping.
2. BOM theory still shows ink kg for planning/comparison.
3. Production jobs can complete printing steps without ink allocation.
4. Ink issue/return/mix/count movements update stock and keep audit rows.
5. Reconciliation shows theory vs actual for a selected window.
6. Tests pass or any remaining failures are documented with exact blocking cause.

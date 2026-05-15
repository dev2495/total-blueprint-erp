# Inventory GRN + Stock Lifecycle Green Report - 2026-05-11

Worktree: `/Users/devarshthakkar/local_repos/erp total/.claude/worktrees/optimistic-borg-130fe2`

## Result

The latest Smart GRN add-on inward blocker and the Period/Audit stock lifecycle UI blocker are fixed in this worktree. The server has been restarted in production frontend mode on port `3001` and is available on LAN.

- Local: `http://127.0.0.1:3001/login`
- LAN: `http://192.168.0.229:3001/login`
- Backend LAN: `http://192.168.0.229:8000`

## Fixes Landed

### Smart GRN add-on inward

- Exposed purchased add-on metadata through the backend material library serializer:
  - `addon_is_purchased`
  - `addon_purchase_uom`
  - `weight_mode`
  - `weight_value`
  - `packaging_defaults_json`
  - `production_template`
- Updated the frontend material contract so Smart GRN can reliably filter true purchased add-ons.
- Tightened Smart GRN purchased add-on filtering:
  - New payloads require `addon_is_purchased=true`.
  - Old/stale payloads can still fallback by UOM so the UI does not break during local transition.
- Added backend regression coverage for the serializer fields used by the GRN picker.

### Stock lifecycle / Period & Audit UI

- Added a real material picker to opening stock entry.
- Opening stock now filters valid materials by selected stock class:
  - Bulk: granules, inks, adhesives, solvents, POD, purchased add-ons.
  - Roll: film variants.
  - Packaging: packaging materials.
- Selecting a material auto-fills material code and UOM for the opening payload.
- Added a visible Count Entry Desk inside the Period/Audit live controls.
- Count Entry Desk can:
  - load plant stock into an audit batch,
  - start a quick count,
  - filter rows by all/bulk/roll/packaging,
  - search by material/location/label,
  - select a real audit line,
  - save counted quantity against the real backend audit line.
- Help routing now resolves `/inventory/period` to the canonical Period & Audit guide instead of stale FY Correction/opening/year-close fragments.
- The stock lifecycle gate now enforces the current navigation model:
  - compact sidebar exposes Inventory workspace,
  - detailed stock lifecycle access is inside the Inventory workspace surface,
  - old direct lifecycle sidebar routes remain removed.

### Inventory workspace smoothness

- Deferred the main inventory search value with `useDeferredValue`.
- Added stable scrollbar gutter and overscroll containment.
- Added content visibility/intrinsic sizing on long sections to reduce scroll/layout work.

## Verification

All commands below passed after the patch set.

- `python manage.py check` - OK
- `python manage.py test apps.inventory.tests.test_addon_bulk_grn` - 3 tests OK
- `npm run typecheck` - OK
- `npm run lint` - OK, with the existing Next font warning in `src/app/layout.tsx`
- `npx playwright test tests/e2e/gate/stock-lifecycle.spec.ts --project=gate` - 2 tests OK
- `npx playwright test tests/e2e/mutations/stock-lifecycle-full.spec.ts --project=mutations` - 1 test OK
- `bash ./start_all.sh restart` - production frontend build and server restart OK
- `bash ./start_all.sh verify` - deep route/auth/API/static asset verification passed

## E2E Flow Proof

The mutation test completed the real V36 lifecycle path:

- opening balance entry,
- inward movement,
- stock count,
- count post,
- period close,
- closed-FY correction.

The full acceptance seed that ran during the stock lifecycle gate also produced roll/pouch/packing proof artifacts, including packaging consumption rows for inner packs, gonny, tape, and roll sheet flows.

## Notes

- No commit was made.
- The worktree is intentionally dirty because this is the combined local update branch.
- A one-off ad-hoc Chrome DOM probe was not used as evidence because local Chrome aborted during launch. The formal Playwright Chrome gates above are the browser evidence for this report.

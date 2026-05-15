# Product Master / Sales Packing Patch Report - 2026-05-14

## Scope

This pass fixed the Product Master and sales-create leaks raised from the 2026-05-14 screenshots in the active Claude worktree.

## Model Fixes

- Roll size editor now stores `roll_form` for roll/POD masters and clears stale `pouch_style`, so the roll-form dropdown no longer loses selection.
- Pouch size editor now stores `pouch_style` and clears stale `roll_form`.
- Live route preview now shows a clear bound-template/no-steps message instead of a blank or confusing preview.
- Product Master packaging roles are consolidated to:
  - `PRIMARY_INNER`: pouch inner pack only, math driven by `ceil(total_pouches / pcs_per_inner)`.
  - `FINAL_GUNNY`: pouch outer seal count only, consumed by Packing Yard seal count.
  - `ROLL_DISPATCH`: roll sheet/wrap only, consumed by EOD packing count / roll packing flow.
  - `EXTRA`: tape, label, tag, carton/box, other EOD-counted packing items.
- Legacy roles `FINAL_CARTON`, `FINAL_OUTER`, and `TAPE` now normalize to `EXTRA` so stale local data does not leak into the UI.
- Sales order create now shows add-ons only when the Product Master has an add-on axis with actual allowed option codes.
- Sales order create now filters packing options by product kind:
  - Roll: roll sheet/wrap + EOD extras; no inner pouch.
  - Pouch: inner pouch, gunny/sheet outer, and EOD extras.
- Customer overlay now captures useful defaults: size, artwork, grade preset, default inner pack, default outer/sheet, and default EOD item.
- Packaging master create now removes stale kind options `OUTER_BAG` and `BOX`; boxes/cartons are handled as `OTHER`/EOD packing items.
- Packaging template lookup failure is caught so the packaging master page no longer blocks on `template-options` timeout.

## Files Changed In This Pass

- `frontend_v2/src/components/product-master/size-geometry-editor.tsx`
- `frontend_v2/src/components/product-master/product-master-edit.tsx`
- `frontend_v2/src/components/product-master/product-master-detail.tsx`
- `frontend_v2/src/components/sales-v3/sales-order-v3-workspace.tsx`
- `frontend_v2/src/app/(dashboard)/master/packaging/page.tsx`

## Verification

- `npm run typecheck`: passed.
- Backend targeted pack: 53 tests passed.
  - `apps.materials.tests_product_master`
  - `apps.sales.tests.test_product_config_order`
  - `apps.production.tests.test_packing_count_service`
  - `apps.production.tests.test_in_house_demand_service`
  - `apps.inventory.tests.test_addon_bulk_grn`
- UI gate on the actual live local stack:
  - `UI_BASE_URL=http://127.0.0.1:3001`
  - `UI_E2E_API_PORT=8000`
  - `operations-ux.spec.ts`: passed.
  - `repeat-order.spec.ts`: passed.
- E2E bootstrap deep verification passed for route probes, auth, API health, asset probes, and seeded acceptance flows.
- Seeded proof covered roll dispatch, pouch packing, WIP gating, stock pool claims, in-house packaging stock, GRN seed data, inter-plant seed data, job work, dispatch challans, and packing material transactions.

## Notes

- An ad-hoc standalone `node -e` Playwright browser probe hit a local Chrome headless launch crash twice. The repo Playwright runner is the reliable verification path here because it uses the project config and completed successfully against Chrome on `3001/8000`.
- The local app remains live on:
  - Frontend: `http://127.0.0.1:3001/login`
  - LAN frontend: `http://192.168.0.229:3001/login`
  - Backend health: `http://127.0.0.1:8000/api/health/`

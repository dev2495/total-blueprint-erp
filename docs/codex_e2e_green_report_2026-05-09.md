# Codex E2E Green Report - 2026-05-09

## Live runtime

- Frontend local: http://127.0.0.1:3001/login
- Frontend LAN: http://192.168.0.133:3001/login
- Backend health: http://127.0.0.1:8000/api/health/
- Backend LAN: http://192.168.0.133:8000
- Worktree: `/Users/devarshthakkar/local_repos/erp total/.claude/worktrees/optimistic-borg-130fe2`
- Commit status: local only, no commit made.

## Product Master model decision

Generic WIP/roll stock is not a separate generic Product Master. The Product Master is the base technical product, and the selected size plus axes produce the frozen invariant signature for the stock pool.

Flow:

1. Product Master holds fixed structure: pouch/roll kind, route template, layer stack, print capability, default geometry, and allowed axes.
2. A stock launcher order selects Product Master, size row, axis values, route stop, quantity, and commitment scope.
3. Scope decides reuse:
   - `GENERIC`: no customer/artwork lock, reusable by matching sales demand before artwork.
   - `CUSTOMER`: customer locked, artwork open.
   - `ARTWORK`: artwork locked, customer open.
   - `CUSTOMER_ARTWORK`: both locked.
4. BOM math comes from the selected master size and layer stack:
   - roll width from ProductMasterSize or selected axis.
   - thickness from layer template or selected thickness axes.
   - stop step from live route template.
   - quantity from stock launcher.
5. If roll width, thickness, live template, route stop, or BOM cannot be resolved, stock launcher blocks creation.

For the dry-fruit 3-layer pouch example, a generic roll stock order is a pre-artwork WIP roll with the same invariant structure. A pre-printed roll is not generic before artwork; it becomes artwork-committed or customer+artwork committed because the print/artwork has become part of the reuse boundary.

## Fixes landed in this pass

- Product Master template persistence:
  - Backend now keeps `template` and `default_template` mirrored on save/update.
  - Product invariant signature recalculates when route/template/layers/axes change.
  - Product Master detail UI refetches saved state and does not drop route template after save.
  - UI edit/save proof passed: `PM-CODEX-DRYFRUIT-3L` kept `CODEX_SAMPLE_POUCH_TEMPLATE_V36` visible after save.

- Product Master size fields:
  - Backend serializer now maps real fields into `geometry_config`: thickness, faces, trim loss, flap/tape, standard qty, and UOM.
  - Detail/editor UI now exposes real geometry fields instead of stale adjustment-only fields.
  - List page count proof passed: dry fruit shows `Sizes 3`, `Axes 7`, `Variants 1`; BOPP shows `Sizes 2`, `Variants 2`.

- Stock launcher:
  - Product Master dropdown now requests active planner masters.
  - Retired stale `PM-E2E-CODEX...` masters are not visible in stock launcher.
  - Old demo masters `PM-DRY-PET-LD`, `PM-ECO-BOPP-PE`, and `PM-SNK-BOPP-MET-CPP` are retired locally and hidden from launcher.
  - Phantom blocker count fixed in shared validation footer.
  - Same-step first-route stop is accepted for generic WIP stock when backend says the stop rule is valid.
  - Browser proof passed for `PM-CODEX-DRYFRUIT-3L`: no blockers, create enabled, stop rule valid, roll width visible, BOM visible, required material preview visible.

- Inventory V36 and GRN backend:
  - Saved views, class snapshots, export endpoints, coverage/reorder data, and inventory V36 endpoints are wired.
  - Smart GRN supports gross/tare/net roll input with net auto-compute.
  - QC docs are optional/collapsible.
  - Add-on inward via bulk GRN is covered, including purchased add-ons with UOM support.
  - Stock count V36 loads the correct default plant from current stock and handles add-on UOM rows.

- Color handling:
  - Ink/add-on swatches now use material names/codes instead of random generated colors where known colors exist.
  - Future artwork/product color fallback is wired through shared color utilities.

## Seeded sample proof

Active sample Product Masters now present:

- `PM-CODEX-DRYFRUIT-3L` - Codex Dry Fruit Pouch 3 Layer - 3 sizes, 1 variant.
- `PM-CODEX-MANGO-3L` - Codex Mango Pouch 3 Layer - 1 size, 1 variant.
- `PM-CODEX-BOPP-VARIABLE` - Codex BOPP Variable Size Thickness Pouch - 2 sizes, 2 variants.
- `PM-CODEX-INNER-POUCH-PACK` - Codex Inner Pouch Packaging Product - 1 size, 2 variants.

Seeded sales orders:

- `SO00232` direct dry-fruit flow.
- `SO00233` artwork-required flow.
- `SO00234` BOPP/POD 220 stock-available flow.
- `SO00235` BOPP/POD 260 no-stock flow with in-house demand.

Latest planned stock proof:

- WIP stock orders include `STK-2026-0164` and `STK-2026-0165`.
- In-house inner-pack demand for `SO00235` created `STK-2026-0163` for `38 PCS` of `PM-CODEX-INNER-POUCH-PACK`.
- No-stock POD demand for `SO00235` created `PBK-2026-0022` for `1.5498 KG` of `POD-260-CODEX`.

Live packing and dispatch proof:

- `SO00232` was taken through a live dispatch proof in the local DB.
- Production job `JOB-CODEX-SO00232-DISPATCH-PROOF` is `COMPLETED` / `COMPLETED` with `1000 PCS` produced.
- FG batch `FG-CODEX-SO00232-DISPATCH-PROOF` moved to `PACKED`.
- Packing unit `G-FG-CODEX-SO00232-DISPATCH-PROOF-001` packed `1000 PCS` as `PRIMARY_PACKS`, used `42` inner packs, captured gross `9.9792 KG`, and moved to `DISPATCHED`.
- Delivery challan `DC-20260509-0001` is `DISPATCHED` with `1000 PCS` / `9.9792 KG`.
- Packaging transactions show transfer and consumption for `42 PCS` of `INNER-POUCH-24-CODEX` and `1 PCS` of `GUNNY-50KG-CODEX`.

## Verification run

Green gates:

- `manage.py check`: OK.
- `manage.py makemigrations --check --dry-run`: OK, no changes detected.
- Focused regression tests for the newly patched backend blockers: 6 tests OK.
- Broad backend flow suite: 163 tests OK across Inventory V36, GRN, add-on inward, inter-plant, inventory audit, Product Master, film grades, packaging master, dispatch, packaging consumption, stock claim, WIP route truth, machine terminal endpoints, in-house demand, stock validator, planner stock launcher, inter-plant completion, and Product Master sales flows.
- `npm run typecheck`: OK.
- `npm run build`: OK. Next.js completed production build; one existing font-loading warning remains in `src/app/layout.tsx`.
- Production restart on port 3001: backend 200, frontend 200.
- `./start_all.sh verify`: deep verification passed.
- UI route sweep on live `127.0.0.1:3001`: `/inventory/grn-v36`, `/inventory/rolls-v36`, `/inventory/bulk-v36`, `/inventory/packaging-v36`, `/inventory/addons-v36`, `/inventory/period`, `/inventory/count`, `/logistics/packing`, `/logistics/dispatch`, `/production/planner/stock-launcher`, `/master/products`, and `/sales/orders/create` all rendered with no relevant console errors.
- Browser Product Master list: sample PMs visible with counts and template.
- Browser Product Master detail: template remains visible after UI save.
- Browser Product Master size editor: real fields visible.
- Browser stock launcher: dry-fruit generic WIP shows all validations passed, create enabled, stop rule valid, roll width visible, BOM and required material visible.
- Browser stock launcher dropdown: only the four active Codex sample masters are visible after legacy-demo cleanup.
- Stale route-link sweep: sidebar/navigation/help content now points at V36/new Product Master routes. Old inventory route files are retained as compatibility redirects only.

## Remaining business decisions before production go-live

No code blocker is open from this pass. Before real production use, the only business data decisions still needed are operational:

- Confirm real vendor/material rate masters for finance valuation.
- Confirm the final sample Product Master naming/code conventions for production data.

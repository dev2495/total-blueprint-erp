# Sales, Planner, Product Master Release Report - 2026-05-18

## Decision

The accepted model is manual catalog linking for PACKAGING and POD Product Masters.

- POUCH and ROLL remain customer-facing Product Masters.
- PACKAGING and POD Product Masters define how in-house SKUs are produced.
- The stock, purchase, and consumption identity stays in the fixed catalog rows under `/master/packaging` and `/master/pod`.
- A PACKAGING/POD ProductVariant never creates or syncs a catalog SKU automatically.
- Admin manually links each in-house variant to one existing fixed catalog SKU. Unlinked fixed SKUs can remain purchased/manual.
- Link choices are type-safe: PACKAGING masters can link only matching PACKAGING kind rows, and POD masters can link only POD SKU rows. Already-linked rows are hidden unless they are the current variant's link.

This keeps real stock stable while still allowing Product Master logic, route templates, planner release, and WCM execution to produce in-house packaging/POD stock.

## Flow Coverage

Verified flows:

- Sales order confirmation and Product Master handoff.
- Planner control tower queue and stock launcher modes.
- Direct FG, WIP continuation, generic jumbo, and slit allocation paths.
- Gang Builder candidate grouping, commit stamping, and WCM multi-child slit allocation support.
- Jumbo roll allocation tiers: order-bound, exact, wider-with-slit, and remainder pool.
- Packing yard and dispatch for roll and pouch flows.
- In-house packaging production, stock visibility, and consumption at FG/dispatch points.
- POD fixed SKU catalog visibility and manual Product Master linkage.
- Template UI compatibility: route/template data remains supported, but removed UI copy that implied packaging/POD SKU auto-sync.

## Local Reset

Applied with:

```bash
python manage.py reset_product_sales_planner_workspace --apply --confirm RESET_PRODUCT_SALES_PLANNER_WORKSPACE --backup-file .runtime/reset-product-sales-planner-applied.json
```

Deleted/reset:

- Product Masters: 18 -> 0
- Product Variants: 40 -> 0
- Sales Orders: 684 -> 0
- Sales SKUs: 8 -> 0
- Quotations: 405 -> 0
- Planned Stock Orders: 372 -> 0
- Planned Bulk Stock Orders: 96 -> 0
- Planner SKUs: 4 -> 0
- Deletable Production Jobs: 1291 removed

Preserved:

- Inventory rolls: 2609
- Inventory bulk rows: 83
- Packaging stock rows: 15
- Packaging transactions: 1259
- Finished goods batches: 79
- Packing units: 24
- Inventory materials/master data: 220
- Templates/master data: 5149

Production jobs tied to existing finished-goods inventory were preserved as provenance.

## Verification

Local stack: `http://127.0.0.1:3001` frontend and `http://127.0.0.1:8000` backend.

Passed:

- TypeScript: `npm run typecheck`
- Django: `python manage.py check`
- Targeted backend tests:
  - `apps.sales.tests.test_reset_product_sales_planner_workspace`
  - `apps.production.tests.test_gang_roll_allocation`
  - `apps.production.tests.test_packaging_consumption`
- Full release green sweep:
  - Gate: 221/221 passed
  - Mutations: 13/13 passed
  - Observations: 8/8 passed
  - UAT manifest: `.runtime/ui-e2e/uat-green-manifest.json`
- Post-reset deep route/static verification passed on the rebuilt local production stack.
- Fresh runtime log scan found no `objc`, fork-safety, SIGKILL, proxy socket hang-up, or closed-browser-context signatures.

## Residual Risk

The model is ready for ERP use. The main operational rule is procedural: PACKAGING/POD variants must be linked to fixed catalog SKUs before planners rely on them for in-house stock. The UI now surfaces linked/unlinked status and the backend rejects category/kind mismatches, so the risky cases are blocked rather than silently synced.

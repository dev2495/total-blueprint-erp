# Go-Live Naming and Readiness Report - 2026-05-10

## Executive status

Status: green after local verification.

This pass adds a production-safe naming convention and wires it into the master-data layer. It does not rename historical/local test rows in bulk. New and edited master records now normalize into stable uppercase ERP codes, and Product Variant auto-codes are semantic instead of long raw-axis dumps.

Current local runtime after restart:

- Frontend local: `http://127.0.0.1:3001/login`
- Frontend LAN: `http://192.168.0.229:3001/login`
- Backend health: `http://127.0.0.1:8000/api/health/`
- Backend LAN: `http://192.168.0.229:8000`

## Naming principles

1. Codes are stable identifiers, not descriptions. Descriptions belong in `name`, `label`, and notes.
2. Codes use uppercase `A-Z`, `0-9`, hyphen, underscore, and dot only.
3. Customer, artwork, and size do not belong in the base Product Master unless the master is truly customer-specific or size-fixed.
4. Product Variant codes include the selected size/geometry and a short hash, because the full axis payload can include POD, inner-pack, grade, artwork, add-ons, and per-layer changes.
5. Sales orders use a year-scoped sequence so the number itself tells the operating year.

## Canonical code formats

### Product Master

Format:

`PM-{FAMILY}-{FORM}-{LAYER_COUNT}L[-QUALIFIER]`

Examples:

- `PM-DRY-FRUIT-STP-3L`
- `PM-MANGO-STP-3L`
- `PM-BOPP-SNK-2L-VAR`
- `PM-INNER-POUCH-1L`

Rules:

- `PM` is always the prefix.
- `FAMILY` is commercial/business family, not raw material.
- `FORM` is short and operational: `STP` stand-up pouch, `3SS` three-side seal, `ROLL`, `SHEET`, `BAG`.
- Layer count is included when the structure matters.
- Use `VAR` only when thickness/size axes are intentionally variable.

### Product Master Size

Format:

`{WIDTH}X{HEIGHT}[-G{GUSSET}]`

Examples:

- `140X200-G60`
- `170X250-G80`
- `210X260-G80`

Rules:

- Capacity such as 100g/250g belongs in the size label, not as the only code.
- Final product size is the identity. Roll width remains in geometry for stock launcher and BOM math, but it is not part of the visible product/variant name.
- For flat roll/sheet sizes, use only the dimensions that actually drive consumption.

### Product Variant

Format:

`{PM_CODE}-V-{SIZE}-T{TOTAL_THICKNESS}U[-POD][-INNER]-{HASH6}`

Example:

`PM-DF-STP-3L-V-DF-250-140X200-T97U-POD-220-2A91B0`

Rules:

- Product Variant is generated from the Product Master invariant plus selected axes.
- The trailing hash is mandatory because two variants can look similar but differ by POD, inner packaging, add-on, grade, or hidden axis values.
- Variant code is scoped by the Product Master in the database. It is still human-readable in UI tables.
- Roll width can still affect the trailing hash when it changes the actual material plan, but it is deliberately hidden from the semantic name.

### Materials

Format:

`{CATEGORY_PREFIX}-{KIND/FAMILY}-{SPEC}`

Recommended prefixes:

- Film family: `FF-{POLYMER}`
- Film variant: `FV-{POLYMER}-{FINISH/TYPE}`
- Granule: `GR-{POLYMER}-{GRADE}`
- Ink: `INK-{SYSTEM}-{COLOR}`
- Adhesive: `ADH-{TYPE}`
- Solvent: `SOL-{TYPE}`
- Packaging: `PKG-{KIND}-{SPEC}`
- Add-on: `ADD-{KIND}-{SPEC}`
- POD film: `POD-{HEIGHT}H-{THICKNESS}U-{S/D}`

Examples:

- `FV-PET-CLR`
- `FV-LDPE-FOOD`
- `GR-LDPE-FOOD`
- `INK-POLY-CYAN`
- `PKG-INNER-POUCH-24-PCS`
- `PKG-GONNY-50KG`
- `ADD-ZIPPER-PCS`
- `POD-220H-30U-S`

### Customer overlays

Format:

`CITEM-{CUSTOMER_CODE}-{PM_SHORT}-{SIZE_SHORT}`

Rules:

- Customer item codes can still store the customer-provided code when the buyer has one.
- Internal overlays should not create a new Product Master if only display name, customer item code, price basis, or artwork default changes.

### Artwork

Format:

`ART-{CUSTOMER_OR_FAMILY}-{PM_SHORT}-{DESIGN_SHORT}-V{NN}`

Rules:

- Artwork code is not part of generic stock identity.
- Once printed, stock becomes artwork-committed or customer+artwork-committed.

### Transaction documents

Current go-live-safe formats:

- Sales order: `SO-{YYYY}-{NNNN}`
- Planned stock order: `STK-{YYYY}-{NNNN}`
- Planned bulk/POD stock order: `PBK-{YYYY}-{NNNN}`
- MTS planned order: `MTS-{YYYY}-{NNNN}`
- Delivery challan: `DC-{YYYYMMDD}-{NNNN}`
- GRN display number: `GRN/{YYYY}/{MM}/{SHORT}`
- Packing unit: `G-{FG_BATCH}-{NNN}`

Decision:

Sales order numbering is now year-scoped. Other document-number formats stay as previously tested.

## Implementation completed

- Added `apps/materials/naming.py` as the canonical naming helper.
- Product Master, Product Variant, Product Master Size, Inventory Material, Commercial Family, POD SKU, and POD SKU Variant now normalize codes on save.
- Product Master and Size serializers now use the same normalizer.
- Product Variant auto-code generation now uses semantic tokens: final product size, total thickness, POD, inner packaging, and a short hash. Roll width is kept in geometry/BOM math only.
- Product Master size geometry exposes the old SKU-variant contract again: width, height, gusset, faces, trim loss, flap/tape, and structured adjustments.
- Sales order auto-numbering now creates `SO-{YYYY}-{NNNN}` and ignores legacy `SO00001` rows for the new year sequence.
- Added naming regression tests.
- Added stale route-link cleanup so help/sidebar/navigation points to V36/new Product Master surfaces.

## Current sample mapping

The local Codex sample data is intentionally tagged as test data:

- `PM-CODEX-DRYFRUIT-3L`
- `PM-CODEX-MANGO-3L`
- `PM-CODEX-BOPP-VARIABLE`
- `PM-CODEX-INNER-POUCH-PACK`

For real production seed data, use the production convention:

- `PM-DRY-FRUIT-STP-3L`
- `PM-MANGO-STP-3L`
- `PM-BOPP-SNK-2L-VAR`
- `PM-INNER-POUCH-1L`

## Verification

The green proof is recorded in `docs/codex_e2e_green_report_2026-05-09.md`.

Fresh verification for this pass:

- `manage.py check`: OK.
- `manage.py makemigrations --check --dry-run`: OK, no changes detected.
- Targeted geometry/naming/order-number suite: 23 tests OK.
- Broad backend flow suite across materials, sales, production, inventory, physics, factory, recipes, artwork, and analytics: 375 tests OK.
- `npm run typecheck`: OK.
- `npm run lint`: OK with the existing non-blocking Next font warning in `src/app/layout.tsx`.
- `npm run build`: OK. Next.js production build completed; one existing non-blocking font-loading warning remains in `src/app/layout.tsx`.
- `./start_all.sh restart`: backend 200 and frontend 200 after prod rebuild.
- `./start_all.sh verify`: deep verification passed, including auth/route probes and static asset probes.
- Authenticated Chrome smoke: `/master/products` rendered with 9 product links and no runtime error; first Product Master detail rendered the Size / geometry axis with the "Final W/H is product identity" copy and roll-width geometry still visible.

Additional stock lifecycle proof on 2026-05-10:

- UI E2E `frontend_v2/tests/e2e/mutations/stock-lifecycle-full.spec.ts`: OK, 1 passed.
- The browser flow posted opening balance, Smart GRN inward, quick count batch, mobile count, approval/posting, period close, and FY correction through the V36 UI.
- Quantity proof in the test path: opening 55 kg, GRN +5.5 kg, count correction to 60 kg, FY correction to 59 kg.
- Movement proof asserted backend transaction types: `OPENING_BALANCE`, `INWARD`, `COUNT_SHORT`, and `FY_CORRECTION`.
- Backend ambiguity fixed: opening balance now posts exact `material_id` and `location_id`; Smart GRN warehouse/storage dropdowns show `Plant · Location code · Location name` so same-code locations do not post to the wrong plant.
- Period-close edge case fixed: closing a non-current/backdated period no longer tries to create a second `OPEN` financial year when another period is already open.
- Targeted backend regression suite after fixes: 39 tests OK across inventory audit, V36 inventory API, add-on bulk GRN, product commitment, and stock claim flow.
- `manage.py check`: OK.
- `manage.py makemigrations --check --dry-run`: OK, no changes detected.
- `npm run typecheck`: OK.
- `npm run lint`: OK with the existing non-blocking Next font warning in `src/app/layout.tsx`.
- `npm run build`: OK.
- Final live restart after build: backend 200, local frontend 200, LAN frontend 200.

Current live QA URLs after the final restart:

- Local frontend: `http://127.0.0.1:3001/login`
- LAN frontend: `http://192.168.0.229:3001/login`
- Local backend health: `http://127.0.0.1:8000/api/health/`
- LAN backend: `http://192.168.0.229:8000`

## Production Codes and Business Setup

"Production codes" here means the real master-data codes used by operators and reports, not software code. Before live entry, the following setup should be signed off in the production tenant:

- Product masters and product sizes: final codes, final W/H/gusset geometry, faces, trim loss, flap/tape, and adjustment rules. Roll width stays in geometry/BOM math, not in visible product naming.
- Route templates and process codes: exact live names/codes for extrusion, printing, lamination, slitting, pouching, packing, and any job-work steps. Mark `has_artwork` / print-capable steps correctly because generic pre-art stock matching depends on the first artwork-capable step.
- Machines/work centers: final plant, work-center, machine, and default WIP/FG/RM location mapping.
- Material masters: granules and grades, film families/variants, ink base/color rows, adhesive/solvent system masters, purchased add-ons with KG/PCS UOM, packaging kind and supply mode, POD profiles and dimensions.
- Opening balances: approved cutoff date, plant freeze window, and real opening stock load for bulk, rolls, packaging, POD, and add-ons.
- Customer/artwork overlays: customer item codes, artwork codes, default packing recipes, and any customer-specific axis defaults.
- Numbering signoff: `SO-{YYYY}-{NNNN}`, `STK-{YYYY}-{NNNN}`, `PBK-{YYYY}-{NNNN}`, `DC-{YYYYMMDD}-{NNNN}`, and GRN display numbering.
- Approval roles: owner/manager signoff policy for period close, FY correction, GRN correction, and any year-end close hard block.
- Cleanup plan: remove local UAT/Codex sample data or start live from a fresh production DB snapshot before real entry.

## Missing before production cutover

No code blocker is open from this pass.

Business/data items still required before live tenant entry:

- Replace `CODEX` sample master codes with final production codes listed above.
- Confirm real vendor names, rates, taxes, and material valuation opening balances.
- Confirm exact customer-provided item codes and artwork design codes.
- Confirm real opening sequence per year if the production tenant should start above `0001`.

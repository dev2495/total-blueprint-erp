# Product Master Final Model And E2E Verification - 2026-05-12

## Final Model

The final Product Master model is a configurable engineering contract, not a SKU variant replacement table.

- Product Master fixes the stable manufacturing identity: live route template, product kind, layer identity/order, allowed catalog-backed axes, geometry rules, and reusable policy.
- Variant tuple is the exact sellable/plannable identity under that master: size/geometry, per-layer thickness, per-layer grade when the film is grade-controlled, optional layer width override, POD, packaging recipe, add-ons, and artwork/colorway when selected.
- Product variant is generated from the tuple and stores the immutable BOM snapshot used by sales, planner, WIP, production, packing, dispatch, and inventory history.
- Customer overlay is not a separate product. It stores customer-specific defaults for the same master/tuple: customer item code, display name, MOQ, price basis, packing default, default artwork/colorway, and permitted override presets.
- Artwork/colorway is the print contract. Artwork may be global or customer-specific. Same product and size can use different artwork, or the same artwork with a different colorway. Color count/front-back mode drives ink/cylinder readiness and print BOM.

## Flexible Geometry Model

The geometry model matches the old SKU variant inputs and keeps the final product size in naming. Roll width is not part of the commercial product name because it is a manufacturing/consumption fallback.

Each size row supports:

- width, height, gusset
- faces
- flat/roll form
- trim loss
- flap/tape allowance
- gusset apply-to: width, height, both, or none
- gusset factor
- adjustment rows, so any special packaging geometry can be expressed without code

The standard fallback is formula-driven:

```text
effective_width = width + width_adjustments + trim_if_width + gusset_if_width
effective_height = height + height_adjustments + trim_if_height + gusset_if_height + flap_if_height
roll_width = effective_web_width from geometry unless layer width override is explicitly selected
```

This preserves flexibility for standup pouch, pillow pouch, sleeve, roll-stock, and customer-specific correction rules without hard-coded product presets.

## Layer, Thickness, And Grade Rules

- Layer identity is fixed at Product Master creation.
- The film is selected from film master data.
- Thickness is selected from the film/master allowed thickness list, not typed freely.
- Grade is selected from active grade master options only when the film requires a grade.
- Purchased-only film, such as BOPP bought as film, does not ask for grade and does not leak grade fields into the tuple.
- Backend validation enforces the same rules as the UI, so API payloads cannot bypass the master-data constraints.

## Generic WIP And Planner Stock Logic

There is no separate generic Product Master.

Generic stock is created by the stock launcher from the same Product Master plus selected axes and stop step:

- Generic WIP/roll stock: no customer lock and no artwork lock. It can feed any compatible sales line with the same invariant tuple.
- Customer committed stock: same invariant tuple, locked to customer.
- Artwork committed stock: same invariant tuple, locked to artwork/colorway.
- Customer + artwork committed stock: locked to both.
- Pre-printed roll is not generic. It is artwork or customer-artwork committed stock.
- Consumption math always comes from Product Master axes: geometry gives width fallback, layer thickness/grade gives material BOM, and selected stop step decides how far WIP is built.

Packaging stock and POD stock use catalog-backed axes. Packaging stock is allowed to run full in-house route without artwork stop-step blocking because it is packaging replenishment, not product WIP.

## Implemented Enforcement

- Product Master create/edit/detail use shared layer controls for film, thickness, grade, and allowed grades.
- Backend Product Master serializer validates template, layer film, thickness options, grade options, and purchased-only film behavior.
- Product variant service validates tuple layer thickness/grade against Product Master options.
- Catalog-backed POD/packaging axes validate list-of-dict catalog options.
- Sales/stock layer matrix uses the same dropdown controls and no longer asks for arbitrary grades.
- Planner stock launcher supports generic, customer, artwork, customer+artwork, packaging, and POD stock creation.
- Seed flow resets old CODEX sample data and creates fresh product masters, variants, GRNs, sales orders, artworks, POD stock, packaging stock, and planner stock orders.

## Sample Data Created

- `PM-CODEX-DRYFRUIT-3L`
- `PM-CODEX-MANGO-3L`
- `PM-CODEX-BOPP-VARIABLE`
- `PM-CODEX-BOPP-1L-VARIABLE`
- `PM-CODEX-INNER-POUCH-PACK`

Sample flows include direct sales, artwork-pending sales, artwork-assigned sales, same artwork with alternate colorway, POD 220 stock available, POD 260 auto-demand, BOPP single-layer no-grade order, roll GRN, add-on GRN, granule GRN, POD GRN, packaging GRN, and all stock launcher commitment modes.

## Verification

Backend seed and stock launcher:

- `seed_codex_sample_product_flows`: all GRNs returned 201.
- Stock launcher validation returned 200 and create returned 201 for generic WIP, artwork committed WIP, customer committed WIP, customer+artwork committed WIP, packaging stock, and POD stock.

Backend tests:

- `manage.py test apps.production.tests.test_product_commitment apps.materials.tests_product_master --keepdb`: 25 OK.
- Broader gate covering materials, sales, production, inventory GRN, v36 APIs, and audit lifecycle: 82 OK.

Frontend:

- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- `./start_all.sh verify`: deep verification passed on the 3001/8000 local pair.

Rendered browser QA:

- Server: `http://localhost:3001`
- LAN: `http://192.168.0.229:3001`
- Browser plugin loaded login but could not type because its virtual clipboard component is not installed, so rendered QA used local Chrome via Playwright.
- Pages verified: product master list, dry fruit product detail, variant matrix, artworks, customer overlays, BOPP purchased-film detail, sales create, sales new, stock launcher, smart GRN, GRN add-on filter, inventory period, inventory count, packing consumption, mobile product master, and mobile sales create.
- Screenshots saved at `/private/tmp/erp-pm-live-qa/`.
- No framework overlay and no page errors were detected. Two pre-login 401 console messages came from unauthenticated auth probes before login; no page crash followed.

## Remaining Decisions Before Live

No core product-model decision is pending. The model supports flexible packaging products without code as long as master data exists for film, grades, POD, packaging, add-ons, artworks, and templates.

Before production migration, owner should confirm:

- final naming wording for product display names and sales order numbers
- master-data cleanup scope for non-CODEX stale test rows
- whether the first production go-live starts with opening-stock freeze/count for all plants or one plant at a time

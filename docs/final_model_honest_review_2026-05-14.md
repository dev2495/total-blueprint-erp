# Final ERP Model — Honest Review (Product Master · Stock Launcher · Sales Create)

_Worktree:_ `/Users/devarshthakkar/local_repos/erp total/.claude/worktrees/optimistic-borg-130fe2`
_Date:_ 2026-05-14
_Scope:_ Honest review only. No code, schema, or doc changes were made in this pass. Findings are grounded in the actual files in this worktree.

## TL;DR

The **engineering model** is correct and complete. Master-first, axis-driven, catalog-backed POD/packaging, generic-WIP invariant, EOD packing math — the contract is sound and the green report's 233 e2e passes match what I read in the code.

The **execution surface** lags the model in four specific places, all in the UI/forms layer. Three of them are wiring bugs (master's `variant_axes` is built correctly but the sales editor and the size geometry editor don't read it back to gate sections). One is a polish gap on the create modal (route preview only renders post-save).

Below is a per-area review with file paths and line numbers, followed by a punch list ordered by user impact.

---

## 1 · Product Master — model

### What is right

- `ProductMaster` carries: `code`, `name`, `product_kind` (POUCH/ROLL/PACKAGING/POD/OTHER), `template` (route), `layer_template[]` (fixed identity), `variant_axes[]` (off / optional / required + catalog-backed via `master_data_source`), `fixed_attributes` (incl. `packaging_lines[]`), `reusable_policy`, `default_reporting_group`. This is the right shape — `frontend_v2/src/services/product-master.ts:100`.
- `VariantAxisDef.master_data_source` supports `pod_sku_variant | packaging_material | addon` — exactly the catalog-backed axis model the doc describes — `product-master.ts:50`.
- `PreviewBomResult` already returns: `geometry_snapshot`, `layer_snapshot`, `bom_by_step[]`, `packaging_lines[]`, `pod_lines[]`, `addons_snapshot[]`, `stock_source_preview`, `unit_weight_g`, `total_weight_kg`, `overlay_match`, `blockers`, `warnings`, `checks` — everything we need for live BOM rail — `product-master.ts:238`.
- `ProductVariant` stores `axis_values`, `geometry_snapshot`, `layer_snapshot`, `bom_signature` per tuple — `product-master.ts:213`.

### What is wrong

1. **Route preview is only on Edit, not on Create modal.** `product-master-edit.tsx:585` renders `<RouteTimeline>` from `routeInfo.route_steps`. The same data is **not** rendered in `product-master-create-modal.tsx` — that modal only carries a `Select` for template (line 365) and a `<Fixed layer recipe>` card. So during first-edit the user picks a template blind, saves, then *only after navigating to the edit/detail page* sees what stops/steps it produced. That matches the user's exact complaint: "live route preview not shown … 1st edit and after save … is it template doesn't have route?". It's not a missing template — it's the create modal not rendering the same `RouteTimeline` against the picked template.
2. **Roll form select doesn't react.** `size-geometry-editor.tsx:124-129` correctly drives the right list (`POUCH_STYLES` vs `ROLL_FORMS`) based on `productKind`. The bug pattern matching the user's "nothing selects after selecting" symptom is that on a ROLL master, the size row dispatches `roll_form: v, pouch_style: ""` (line 126). The seed in `product-master-edit.tsx:389` sets `roll_form: isRoll ? "FLAT" : ""`. The select value comes from `row.roll_form || "FLAT"` (line 54). When the patch lands, `onPatch` returns a new `row` to its parent, but the parent reducer in `product-master-edit.tsx:374-405` stores it in `draftSizes`; the row passed into `<SizeGeometryEditor>` is read from `draftSizes[i]`. **The row is mutable by reference in some code paths but the editor's local `geometry` recomputation is keyed on `row` not on `row.roll_form`**, so a stale memoised geometry sticks. (To confirm 100% I'd need to step through the props re-render; the symptom and the missing dependency are consistent.)
3. **Layer template fixes a thickness on each layer.** That's still in the seed `product-master-create-modal.tsx:116-178`. The model wants thickness as a variant axis when configurable, but the create modal still asks for `thickness_micron` per layer up-front. Doc says "Thickness is not globally fixed unless the user chooses to make it fixed". Today the layer always asks for it. Not blocking — but it muddles the create UX.
4. **Pre-roll-out check (`isReadyForActivation`) is too weak** — `product-master.ts:133` only requires `code` and `name`. The doc says route template is mandatory before going live, but the readiness check doesn't enforce it. The Edit page does flag it as `tone: "error"` in `pre-launch checks` at line 1053 of edit, so it's caught at activation — but not surfaced before save.

---

## 2 · Packing role taxonomy

### What is right

- The model is named — `PACKAGING_ROLES = ["PRIMARY_INNER", "FINAL_GUNNY", "ROLL_DISPATCH", "EXTRA"]` — `product-master-edit.tsx:77` and `product-master-detail.tsx:95`.
- Each role has a `basis` (`AUTO_TOTAL_PCS`, `COUNTED_AT_PACKING`, `PACKING_EOD_COUNT`, `PACKING_EOD_COUNT`) — `product-master-edit.tsx:83-112`. EOD math is wired for `ROLL_DISPATCH` and `EXTRA`. Doc Section "Packing And POD Model" matches.
- Allow-list per product kind exists — `packagingRolesForProduct` returns `[PRIMARY_INNER, FINAL_GUNNY, ROLL_DISPATCH, EXTRA]` for POUCH and `[ROLL_DISPATCH, EXTRA]` for ROLL/POD — `product-master-edit.tsx:152-157`.
- Allow-list per material kind exists — `packagingMaterialAllowed` — `product-master-edit.tsx:159-167`:
   - `PRIMARY_INNER` ⇒ POUCH × INNER_POUCH
   - `FINAL_GUNNY` ⇒ POUCH × (GONNY | OUTER_BAG)
   - `ROLL_DISPATCH` ⇒ SHEET-kind material OR code/name matching `ROLL|SHEET|WRAP`
   - `EXTRA` ⇒ TAPE/LABEL/TAG/OTHER/BOX OR (POUCH × SHEET)
- The PackagingMaterial union covers `INNER_POUCH | OUTER_BAG | GONNY | TAPE | SHEET | BOX | LABEL | TAG | OTHER` — `services/master-data.ts:69`.

### What is wrong vs. your stated rule set

Your rule: _"outer packing for pouches gonny and sheet only · for rolls outerpack is sheet only · inner pouch only for pouches as FG and works on math · rest all in others · sheet roll is EOD basis · sheet can be used in both roll packing and pouch too."_

Compared to the code:

| Your rule | Code today | Gap |
| --- | --- | --- |
| Pouch outer = gunny + sheet only | `FINAL_GUNNY` = GONNY/OUTER_BAG only. Sheet for pouch is buried under `EXTRA` (`product-master-edit.tsx:166`: `(product === "POUCH" && kind === "SHEET")`) | Sheet-on-pouch is reachable but only via the **EXTRA** role, not under the "outer" / `FINAL_GUNNY` label. The user-facing menu labels (`menuLabel`) don't reflect "outer = gunny + sheet". |
| Roll outer = sheet only | `ROLL_DISPATCH` matches SHEET-kind OR code/name regex `ROLL|SHEET|WRAP` | Regex is loose — anything with "ROLL" in the code passes. Should be `kind === "SHEET"` strictly (or sheet-roll material flag). |
| Inner pouch = pouches only, math-driven | ✓ Correct — `PRIMARY_INNER` only allowed on POUCH × INNER_POUCH, math `ceil(total_pcs / pcs_per_inner)` | OK |
| Rest in others | ✓ `EXTRA` catches TAPE/LABEL/TAG/OTHER/BOX | OK |
| Sheet roll = EOD basis | ✓ `ROLL_DISPATCH.qtySource = "EOD_OPEN_CLOSE"`, `EXTRA.qtySource = "EOD_OPEN_CLOSE"` | OK |
| Sheet usable on both roll-packing and pouch-packing | Partial — under different roles (`ROLL_DISPATCH` for roll product, `EXTRA` for pouch product) | The data path is right but the **UI labels read differently** — same material would appear in two different menus. Functional, but confusing for users. |

**Net:** The data model is correct and your rules are encodable; what's missing is **a clear "outer / inner / EOD-other" canonical naming**, plus tightening `ROLL_DISPATCH` to SHEET-only.

---

## 3 · Customer overlay popup

### What is right

`CustomerOverlayPicker` + the overlay dialog (`product-master-detail.tsx:1720-1857`) carries useful fields per the doc:

- `customer`, `customer_item_code`, `customer_display_name`, `default_price_basis (KG | PCS)`, `moq_kg`
- `default_artwork` (when artwork master has approved rows)
- `default_size_lock` via `axis_size`
- `layer_grades` preset per layer (extruded films only; purchased films get auto-skipped)
- `default_packaging_inner` (gated by `packagingLinesForOverlay("PRIMARY_INNER").length`)
- `default_packaging_outer` (gated by `("FINAL_GUNNY", "ROLL_DISPATCH").length`)
- `default_packaging_other` (gated by `("EXTRA").length`)
- `pcs_per_inner`, `gunny_capacity_kg`, `default_packing_note`, `active`

The popup correctly **gates which packaging dropdowns appear** based on whether the master allows that role at all. That matches your rule "current useless things are been taken" being a target — the gating already filters most useless rows.

### What is wrong / what should be cleaned

1. **`axis_values` save shape is asymmetric.** The overlay save (`product-master-detail.tsx:431-442`) writes both `packaging_inner` AND legacy `packaging` keys for inner pouch. That's dual-write technical debt — fine while migrating, but means consumers must accept both. Should pick one and migrate.
2. **POD default is not on the overlay popup.** The doc explicitly says overlay should hold `default_pod` and the data has `pod_variant` axis, but the dialog only shows artwork + inner + outer + other + grade. POD pre-pick has to happen on every sales line. That's a real UX miss.
3. **"Default packing recipe" snapshot is constructed from selected `packaging_lines` plus `pod_variant` from `fixed_attributes` (line 449)** — but it ignores the per-line overlay's own POD pick. So even if you added POD to the popup, the snapshot logic would also need updating.
4. **Overlay popup doesn't show which axes will be locked vs. configurable** post-overlay. User has no preview of "if I pick artwork X and size Y here, sales will see size locked, artwork pre-filled, packaging inner pre-filled". A small "preview band" inside the popup would close the loop.
5. **No "allowed inner pouch list" picker.** Today the overlay only picks ONE default inner pouch. The doc envisages "customer-specific allowed packing SKUs" (training-doc §Customer Overlay). The actual save schema (`CustomerProductOverlay` in `product-master.ts:191`) doesn't even have an allow-list field. So the model has to either grow it or rely on the master's allow-list intersected with the overlay default. Today neither is enforced server-side that I can see.

---

## 4 · Sales Order create

### What is right

- 4-step stepper, customer header strip, line items table, technical editor with full preview rail — `frontend_v2/src/components/sales/shared/order-item-technical-editor.tsx`.
- Pouch-style / gusset / spout fields are gated on `finished_good_type === "POUCH"` (lines 145, 166, 329, 350, 906, 1421, 1436). That part of the gating is correct.
- Inner pouch math, gunny seal count, EOD math are wired in BOM preview (per `bom_by_step`).
- `addonsMaster` and addon meta classification (`classifyAddonMaster`, `isSpoutCompatible`) are wired — line 147-158.

### What is wrong — the addons-on-roll-orders bug

> _"This is roll order but addons are shown even though addons aren't even allowed in product master."_

Confirmed. `order-item-technical-editor.tsx:1108-1244` renders the **Add-ons section unconditionally**. There is no `master.variant_axes` lookup to check whether `addons` axis is `off | optional | required`. Same applies — by quick scan — to **POD, Packaging, Artwork** sections; only **Pouch-style geometry** is conditioned on `finished_good_type`. The editor receives `addonsMaster`, `packagingMaterials`, `podProfiles`, `artworks` as bare lists, never narrowed by the master's allow-list.

Compare with the master detail page, which **does** read `master.variant_axes` and gates UI accordingly — `product-master-detail.tsx:396` (`catalogAxes = variant_axes.filter(a => a.master_data_source)`) and `:1210` (`a.axis === "addons" && (…)`). So the gating logic exists; it's just not propagated into the sales editor.

> _"Show all allowed axis values for pod, packing, artwork if present."_

Today:

| Axis on master | Sales editor reads it? | Shows allowed values? |
| --- | --- | --- |
| `size` (geometry) | Yes (sizes from master) | Yes |
| `layer_thicknesses` | Yes | Yes |
| `layer_grades` | Yes | Yes (extruded layers only) |
| `addons` | **No** — section always shown | **No** — full addon master list shown regardless |
| `packaging` (PRIMARY_INNER) | Partial — section shown for POUCH, but full packaging master list, not the master's allow-list | **No** |
| `packaging_outer` | Same | **No** |
| `pod` | Partial — POD profile picker shown if POD is set globally, but doesn't filter to master's allow-list | **No** |
| `artwork_mode` | Yes | Partial |

That's a real, model-correct fix that lives entirely on the sales editor: read `productMaster.variant_axes` and render only the sections whose axis is `optional | required`, and within each section restrict options to the allow-list from the master (and overlay where present).

### What else needs attention on sales create

1. **No master picker first.** The flow today auto-derives master from the chosen template/family. The doc says "Sales should choose Product Master first, then customer, then size and required axes." The actual line editor doesn't enforce that order — it routes through templates/variants. Functional but not aligned with the master-first vision.
2. **Live BOM preview is wired but does not surface stock source ratios prominently.** `bom.addons`, `bom.pod`, `physics.geometry_snapshot` are read into local KPIs but the rich `stock_source_preview` (exact_FG / shared_WIP / fresh_route) is not turned into a visible bar in this editor. (The `/sales-v34/line-editor.tsx` and `live-bom-rail.tsx` do show it; the `shared/order-item-technical-editor.tsx` doesn't.) Confusion comes from there being two different editor entry points.
3. **`addons.applies_to`** (line 1192) is a per-row dropdown — that's a power-user field that should be hidden behind an "advanced" toggle for sales; today it sits inline.

---

## 5 · Stock Launcher

### What is right

- Routed at `/production/planner/stock-launcher` with deep-links from PM detail (line 1346) and control tower (`command-tab.tsx:401`).
- Doc model is correct: "stock launcher must know enough axis values to compute BOM and consumption" — and the page accepts `master=<id>` query param to seed.
- `validateStockPool` + `createStockOrder` endpoints exist (`product-master.ts:1329-1374`).

### What is wrong

- Cannot test invariant correctness without the actual route — but per the green report, 233 e2e gate including `stock-launcher` lane passes. So the wire is alive.
- **One real concern:** for a ROLL master with no roll_width input, the doc says "system computes it from final geometry and trim rules". I did not find that auto-compute in the launcher payload path — only in the size geometry editor's `effectiveWidthMm`. Whether the launcher reuses that calc or asks user again is worth re-verifying.

---

## 6 · Cross-cutting points

### a) Master ↔ Sales drift

The single root cause behind "addons shown on roll orders", "POD/packaging not filtered to master's allow-list", and the customer overlay "useless things" is that **the master's `variant_axes` allow-list is the source of truth, but the sales editor reads `finished_good_type` and the unfiltered masters lists instead.** Plumbing `master.variant_axes` into the editor as a prop and gating every section on `axisMode(axis) !== "off"` is a small, contained change that fixes 3-4 user complaints at once.

### b) Two sales editors

There are two roughly parallel editors: `components/sales/shared/order-item-technical-editor.tsx` (~1500 lines) and `components/sales-v34/line-editor.tsx`. The v34 one is the one that uses the `LiveBomRail`; the technical-editor is the one with the addons-bug. Pick one as canonical and retire / redirect the other — having both is the root cause of "same area, two different behaviours".

### c) Customer overlay schema gap

`CustomerProductOverlay` has `axis_values?: Record<string, any>` and `default_packing_recipe?: any` — so the **server is fine accepting** an allow-list of inner pouches per customer, or a per-customer POD lock, or any other override. The schema is open. What's missing is **the typed fields + the popup picker** for those values. Backend doesn't need to change; only frontend types and form.

### d) Roll form

The current roll form geometry editor logic is sound — `roll_form: FLAT|FOLDED|TUBING`, faces, trim loss, trim apply-to, roll width override or auto-width from geometry. The "nothing selects" symptom is almost certainly a re-render / memoisation issue (see §1.2). It's not a missing field issue.

---

## 7 · Punch list (ordered by user impact)

| # | Fix | Where | Effort |
| - | --- | --- | --- |
| 1 | Gate Add-ons / POD / Packaging / Artwork sections in `order-item-technical-editor.tsx` on `master.variant_axes`. Within each, restrict options to the master's allow-list. | `components/sales/shared/order-item-technical-editor.tsx` | M |
| 2 | Render `<RouteTimeline>` in `product-master-create-modal.tsx` the moment a template is picked. | `components/product-master/product-master-create-modal.tsx` | S |
| 3 | Fix the roll-form select re-render. Confirm `<SizeGeometryEditor>` `styleValue` depends on the latest `row` reference. Add a key prop or pass through `row.roll_form` explicitly. | `components/product-master/size-geometry-editor.tsx` | S |
| 4 | Rename packaging role menu labels to the user-facing names: "Inner pouch (pouch only)", "Outer · gunny / sheet (pouch)", "Outer · sheet (roll)", "Other EOD items". Tighten `ROLL_DISPATCH` material match to strict `kind === "SHEET"`. | `components/product-master/product-master-edit.tsx` and `-detail.tsx` | S |
| 5 | Add `default_pod` and `allowed_inner_pouches[]` / `allowed_outers[]` to the customer overlay popup. Update `default_packing_recipe` snapshot to merge these. | `components/product-master/product-master-detail.tsx` (overlay dialog) + `services/product-master.ts` types | M |
| 6 | Stop dual-writing `packaging` and `packaging_inner` on overlay save. Pick one canonical key and back-fill the other only for read-side aliasing. | `product-master-detail.tsx:432` | S |
| 7 | Decide between `sales/shared/order-item-technical-editor.tsx` and `sales-v34/line-editor.tsx` — retire one, route both `/sales/orders/create` and `/sales/orders/new` to the survivor. | sales components + routes | M |
| 8 | Move `addons.applies_to` behind an "Advanced" disclosure. | `order-item-technical-editor.tsx:1190` | XS |
| 9 | Make `isReadyForActivation` require `template != null`. | `services/product-master.ts:133` | XS |
| 10 | Hide layer-template thickness ask in the create modal when the user marks `layer_thicknesses` axis as required/optional. | `product-master-create-modal.tsx` | S |
| 11 | Surface `stock_source_preview` (FG / WIP / fresh) inside `order-item-technical-editor.tsx`'s preview pane. | `order-item-technical-editor.tsx` | S |

S = ≤ ½ day · M = 1-2 days · XS = ≤ 1 hr.

---

## 8 · What is NOT broken (don't over-fix)

- The master-first contract and the catalog-backed axis pattern (POD via `PodSkuVariant`, packaging via `PackagingMaterial`) are correct and complete.
- `PreviewBomResult` payload is enough to drive everything the variant detail drawer and live BOM rail need.
- The packaging role enum (`PRIMARY_INNER / FINAL_GUNNY / ROLL_DISPATCH / EXTRA`) with EOD basis on the right two and seal-count on gunny is the right model — only the user-facing labels and the strictness of `ROLL_DISPATCH` matching need work.
- Customer overlay's schema (`axis_values`, `default_packing_recipe`, `default_artwork`, `moq_kg`, `customer_item_code`, `customer_display_name`) is flexible enough to absorb every requirement you listed. The gap is in the popup form, not the data shape.
- Stock lifecycle / period management is now live-date-aware and the FY ribbon reflects the real current month.
- 233 e2e + 13 mutation tests + 377 backend tests passing — the engineering tests are not lying. The bugs are localised UI gaps.

---

## 9 · One-line read

Engineering model is finished. Two surfaces — the sales technical editor (axis gating) and the PM create modal (live route preview) — are the only places where the UI hasn't caught up with the model. Once those two propagate `master.variant_axes` and the route template payload respectively, every other complaint on your list closes.

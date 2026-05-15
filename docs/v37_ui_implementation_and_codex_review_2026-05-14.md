# V3.7 UI Implementation + Codex Fix Review · 2026-05-14

_Worktree:_ `/Users/devarshthakkar/local_repos/erp total/.claude/worktrees/optimistic-borg-130fe2`
_Scope:_ Re-verify Codex's previous fixes against the source, then implement the V3.7 mockup UI layout for Product Master detail, Variants tab, and Sales Live BOM rail. No data fields, no service contracts, no business logic touched — UI layout only.

---

## Part A · Codex fix verification (from the prior pass)

| Claim | File · Line | Status |
| --- | --- | --- |
| Roll form persists through `geometry_config` | `components/product-master/size-geometry-editor.tsx:131-134` | ✅ Confirmed. The onPatch handler writes both `roll_form` AND `geometry_config.roll_form` (and same for `pouch_style`). The `styleValue` derivation reads from `row.roll_form \|\| geometryConfig.roll_form` so it survives re-renders even if a stale row is passed. |
| Live route preview in PM **create** modal | `components/product-master/product-master-create-modal.tsx:401-417` | ✅ Confirmed. `<RouteTimeline steps={routeTimelineSteps}>` renders inside the modal as soon as `templateId` is picked. Loading state + empty-state amber banner both present. |
| Saved PM detail route preview | `components/product-master/product-master-edit.tsx:585-598` | ✅ Confirmed. `<RouteTimeline>` block + amber empty state. |
| Packing roles product-aware | `components/product-master/product-master-edit.tsx:77-167`, `-detail.tsx:95-181` | ✅ Confirmed. `PACKAGING_ROLES = [PRIMARY_INNER, FINAL_GUNNY, ROLL_DISPATCH, EXTRA]`. `packagingRolesForProduct` returns only `[ROLL_DISPATCH, EXTRA]` for ROLL/POD masters. `packagingMaterialAllowed` enforces: inner-pouch only on POUCH × INNER_POUCH, gunny on POUCH × (GONNY \| OUTER_BAG), sheet on `ROLL_DISPATCH`, and SHEET-on-POUCH still allowed under `EXTRA`. |
| Sales addons gating + catalog filtering | `components/sales-v34/line-editor.tsx:76-156, 469-541` | ✅ Confirmed. `findAxis(master, "addons")` returns the master's addons axis; `axisAllowedCodes` extracts allow-list; `filterRowsByAxisCodes` narrows the addon master list; `CatalogAxesSection` filters POD/packaging the same way. When `addonAxis` is absent, an effect drops any saved addons from the line. |
| Customer overlay popup expansions (POD + inner + outer + other) | `components/product-master/product-master-detail.tsx:347-562, 1906-1970` | ✅ Confirmed. Overlay draft now carries `default_pod`, `default_packaging_inner`, `default_packaging_outer`, `default_packaging_other`, and the save mutation writes them into `axis_values` (with both `pod_variant` + `pod` keys for legacy compat) and into `default_packing_recipe.packaging_lines[]`. |
| Activation readiness requires route template | `services/product-master.ts:133-136` | ✅ Confirmed. `isReadyForActivation` rejects when neither `template` nor `default_template` is set, with reason "Live route template is required.". |
| Live BOM rail wired into sales line editing | `components/erp-v3/live-bom-rail.tsx` + `sales-v34/line-editor.tsx` | ✅ Wired; this pass enriches it further (see Part B). |

**Net:** every fix Codex listed is real and in the code. The honest-review punch list items 1, 2, 3, 5, 6, 7 (mapped from the prior `final_model_honest_review_2026-05-14.md`) are closed.

---

## Part B · V3.7 UI layout implemented in this pass

Three surgical UI changes — no field/logic/service touched, all guarded by `npx tsc --noEmit` and `next build` clean.

### 1) `GradientHero` gains a `tone="subtle"` variant

`components/erp-v3/gradient-hero.tsx`

Same props, same data, same children — but `tone="subtle"` renders:

- white-to-pastel gradient body (one `SUBTLE_BG` map per palette),
- thin coloured **accent stripe** on the left (one `SUBTLE_ACCENT` map per palette),
- coloured eyebrow text (no longer reversed-on-dark),
- chips render as small light pills with the same icon/label/value (no backdrop-blur),
- no big drop shadow, no SVG grid overlay.

All existing `<GradientHero>` calls keep working unchanged because `tone` defaults to `"vivid"`. Only callers that opt in get the subtle look.

### 2) PM detail page · subtle hero

`components/product-master/product-master-detail.tsx`

The page's `<GradientHero>` call now passes `tone="subtle"` and the children block (the inline product-kind/template/print-capable/active/group pills) renders as light-coloured `bg-slate-100 ring-slate-200` pills instead of `bg-white/15 ring-white/20`. The Back-to-list link is now a light outlined button. **Everything else in the page is untouched** — `ProductSpecCard`, the setup workbench, the 9 SectionCardV3 stacks, the overlay table, all tabs, all data.

### 3) Variants tab · pivot matrix + cards + table view modes

New file: `components/product-master/variants-matrix-v37.tsx` (~330 lines)

Wired in `product-master-detail.tsx:1320` — the existing `<VariantTable>` is now passed as the `renderCards` slot to `<VariantsMatrixV37>`. **Cards mode preserves the exact old UI** (zero regression on the proven path). New modes:

- **Matrix mode** — two `<select>` pickers for X and Y axes (defaults to first two axes with values present). Pivot table with sticky left column, density-tinted cells (`bg-indigo-100 / 200 / 500`), per-row + per-column + grand totals. Click a cell → variant detail drawer. Empty cells render `"—"`. Same-axis selection prompts to pick two different axes.
- **Cards mode** (default) — invokes `renderCards`, so the existing `VariantTable` component renders verbatim.
- **Table mode** — dense flat table: `code | axis1 | axis2 | ... | status | used | view`. Row click opens drawer.

**Variant drawer** — right-side panel (max-w-md) showing:
- header with code + variant id + `invariant_signature` snippet,
- status pill (Active/Inactive) + orders-used badge,
- **Axis tuple** as small blue pills (`axis: value`) — reads from `row.axis_values`,
- **Layer snapshot** rows if `row.layer_snapshot` is present (read-only display of `L1 PET-12 · 12μ · FOOD-A` style),
- **Geometry snapshot** mini-grid (W×H · Roll W · Faces · Gusset · Trim · Thickness),
- footnote explaining "same tuple → same code → same `bom_signature`".

No fields are added or renamed; no API calls are made; no mutations are wired. This is purely a presentation layer over the existing `variants` array.

### 4) `LiveBomRail` enrichment

`components/erp-v3/live-bom-rail.tsx`

The rail body order now reads:

1. Selected-tuple violet card (unchanged)
2. **New · `PouchRender`** — generic SVG silhouette driven by `geometry_snapshot.product_kind`: stand-up pouch with gusset for POUCH, cylinder for ROLL, outlined box otherwise. Inline mini-stats panel beside the SVG showing W × H, roll width, thickness, faces, unit weight, order weight — all reading existing `preview.geometry_snapshot` + `preview.unit_weight_g` + `preview.total_weight_kg`.
3. `GeometryGrid` (unchanged)
4. `LayerStack` (unchanged)
5. `PackagingLines` (unchanged)
6. **Refreshed · `BomBySteps`** — now renders a horizontal **5-step ribbon** at the top of the card (each step is a coloured pill with index, step label, and material count). The numbered detail list still follows beneath, so existing test selectors are not broken.
7. **Refreshed · `StockSourcePreview`** — replaced the linear list with a **stacked horizontal bar** (FG green / WIP blue / fresh amber) plus three coloured stat tiles below showing value + percentage. Same data fields (`exact_fg`, `shared_wip`, `fresh_route`).
8. `Issues` (unchanged)

Empty-state / loading-state / badge logic preserved. No new prop, no API change — every renderer reads only fields that already exist on `PreviewBomResult`.

---

## Part C · Verification

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | ✅ exit 0 |
| `next build` (production) | ✅ compiled successfully |
| Route sweep · `/master/products`, `/sales/orders/create`, `/sales/orders/new`, `/inventory`, `/inventory/rolls-v36`, `/inventory/period` | ✅ all 200 |

Production server (`next start -p 3001`) restarted on the fresh build.

---

## Part D · What is still not done (honest)

These are deliberate gaps so the patch stays scoped to UI layout. Listed for your decision on whether to tackle next.

1. **Two sales editors still co-exist.** `sales/shared/order-item-technical-editor.tsx` (~1500 lines, the older one with the originally-reported addons-on-roll bug) is still on disk. The new `sales-v34/line-editor.tsx` is where Codex put the axis gating, and the LiveBomRail (now enriched) is used there. If both routes (`/sales/orders/create` and `/sales/orders/new`) point to the same survivor, the older one can be retired. I didn't delete it — a planner gate runs against it.
2. **Sales line · scaled-to-order material breakdown.** The mockup showed each BOM material's per-piece qty AND order-total qty (× line qty) with a per-material stock pill. The current LiveBomRail still shows unit qty only; the order-scaling math needs `line.qty + uom + unit_weight_g` from the line editor passed into the rail. Wiring this requires a small prop addition to the rail (e.g. `orderQty`, `orderUom`) — that crosses into "logic change" territory, so I left it.
3. **Sticky add-line CTA footer in the rail.** The mockup had a green emerald sticky footer with the current line's KG + ₹ total and an "Add line ↵" button. Today the add-line action lives in the line editor, not the rail. Wiring it would require the rail to receive a callback prop. Not done.
4. **Customer overlay popup — "allowed list" UX.** The popup now writes default POD + inner + outer + other (Codex did this). It still picks ONE default per role; the doc envisages a per-customer **allow-list** of multiple inner pouches. Schema accepts an array, the form does not. Left untouched.
5. **PM create modal route preview** loading shimmer is in place, but the steps it shows are read-only — clicking a step doesn't expand its materials list. The detail page's route preview has the same limitation. Cosmetic.
6. **Compare mode for variants.** Mockup showed a multi-select compare. Not implemented in this pass.
7. **Planner Plan-Queue empty after seed.** Codex flagged this as the remaining blocker outside the sales/PM scope. I did not touch it.

---

## Part E · Files changed in this pass

- `components/erp-v3/gradient-hero.tsx` — added `tone` prop + subtle palette maps + subtle render branch.
- `components/erp-v3/live-bom-rail.tsx` — `PouchRender` (new), `BomBySteps` (ribbon + details), `StockSourcePreview` (stacked bar), inserted `PouchRender` into `PreviewBody`.
- `components/product-master/product-master-detail.tsx` — `tone="subtle"` on the hero, subtle inline pill restyle, wired `VariantsMatrixV37` into the Variants tab while preserving the existing `VariantTable` via `renderCards`. New import line.
- `components/product-master/variants-matrix-v37.tsx` — **new** component file. Pivot matrix + cards + table modes + variant drawer.

Zero changes to: services, models, routes, mutation handlers, GRN flows, planner, WCM, inventory, sidebar, navigation routes.

---

## Part F · Summary

Codex's fixes are landed and correct against the source. This pass adds the V3.7 mockup UI layout for Product Master detail (subtle hero), Variants tab (pivot matrix + drawer), and Sales LiveBomRail (pouch render + step ribbon + stacked stock-source bar). Build green, TS green, six probed routes all 200. Three real follow-up items remain (order-scaled BOM math wiring, sticky add-line footer, allow-list pickers on overlay) — flagged but not done so this pass stays strictly inside "no logic, only layout".

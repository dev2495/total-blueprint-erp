# Sales Order Create — V3.4 Redesign

> **Audience:** Codex implementation agent.
> **Status:** Design doc. No code changes ship from this doc — separate PRs execute it.
> **Predecessor:** `product_master_v33_backend_handoff.md` (catalog-backed axes), `product_master_v34_stop_step_model.md` (stop-step / BULK removal).
> **Goal:** Restore v2's 2-click feel for repeat orders without losing v3's "no SKU prework" power. Add multi-line cart. Wire catalog-backed axes (POD, inner-pack, outer-pack) and live BOM preview into the line editor.

---

## 1. The problem with today's Create

The current `/sales/orders/create` workspace ships with a **6-step wizard** that's tuned for first-time configuration:

```
Customer → Product Master → Pick axes → Quantity + packing → Artwork / print → Review
```

That's the right shape for "a brand-new product master being ordered for the first time" — maybe 5 % of orders. For the other 95 % (repeat orders, customer overlays already exist, axes haven't changed), it's six clicks of friction. The previous v2 system was 2 clicks: pick existing variant → quantity → add to cart.

V3.4 needs to recover that 2-click feel **without giving up** the V3 expressivity. Three ideas, stacked.

---

## 2. The redesign — three layers, one screen

```
┌──────────────────────────────────────────────────────────────────────┐
│  GRADIENT HERO                                                        │
│  Customer + KPI chips                                                 │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│  QUICK START BAND      (only after Customer is picked)                │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ ┌─────┐ │
│  │ Last order     │  │ Last but one   │  │ Saved preset   │ │  +  │ │
│  │ DF-ALMOND      │  │ DF-CASHEW      │  │ Standard 250g  │ │ New │ │
│  │ SNK-250 1000KG │  │ SNK-100 500KG  │  │ Almond Pouch   │ │ line│ │
│  │ Apr 18 · ₹312  │  │ Apr 4 · ₹308   │  │ Used 42 times  │ │     │ │
│  │ [+ Add line]   │  │ [+ Add line]   │  │ [+ Add line]   │ │     │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ └─────┘ │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│  CART  ·  3 lines  ·  ₹2,11,400  ·  3,400 KG total                   │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ 1  PM-DRY-PET-LD  ·  SNK-250  ·  DF-ALMOND  ·  1000 KG  [×]  │    │
│  │    POD-220-30U-GP  ·  INNER-POUCH-24  ·  GUNNY-25KG          │    │
│  │    [Edit axes]  [Duplicate]  [Quantity 1000 KG]  ₹3,12,000   │    │
│  └──────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ 2  PM-DRY-PET-LD  ·  SNK-100  ·  DF-ALMOND  ·  500 KG   [×]  │    │
│  │    POD-220-30U-GP  ·  INNER-POUCH-48                         │    │
│  │    [Edit axes]  [Duplicate]                  ₹1,56,000       │    │
│  └──────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ 3  PM-CASHEW-MULTILAYER  ·  CSH-250  ·  CSH-GREEN  ·  900 KG │    │
│  │    POD-220-30U-GP  ·  INNER-POUCH-24                         │    │
│  │    [Edit axes]  [Duplicate]                  ₹2,80,800       │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
│  [+ Add another line]                                                 │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│  ORDER METADATA  (compact — single row)                               │
│  Order name [ ____ ]   Promised dispatch [ Apr 28 ]   Remarks [____]│
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│  RIGHT RAIL                                                           │
│  ── Order anatomy (visual of currently selected line)                 │
│  ── Catalog BOM preview (per-line auto-demand summary)                │
│  ── Live BOM rail (master totals)                                     │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│  STICKY FOOTER                                                        │
│  Cart: 3 lines · 3,400 KG · ₹7,48,800       [Save draft] [Submit ➜]  │
└──────────────────────────────────────────────────────────────────────┘
```

The 6-step strip from today goes away. The screen is **one scrollable workspace** with quick-start at top, cart in the middle, metadata + footer at bottom. Each line is a **mini-card** — collapsed by default, expanded only when the user clicks "Edit axes". This shrinks the screen massively for repeat orders.

---

## 3. Three personas, three flows

### Persona A — *"Acme repeat order, every Monday"*

1. Pick Customer = Acme. **(1 click)**
2. Quick Start band shows their last 3 orders. Click **+ Add line** under "Last order: DF-ALMOND SNK-250 1000 KG". Line drops into the cart pre-filled with axes, qty, prices. **(1 click)**
3. Hit Submit. **(1 click)**

**Total: 3 clicks.** This is the v2-equivalent flow, restored.

### Persona B — *"Same customer, mixed cart of 3 SKUs"*

1. Pick Customer. **(1 click)**
2. Click **+ Add line** under "Last order" → line 1 in cart.
3. Click **Duplicate** on line 1, change size from SNK-250 to SNK-100 → line 2 in cart. **(2 clicks: Duplicate + Edit axes → Size)**
4. Click **+ Add line** under "Saved preset: CSH-GREEN" → line 3 in cart. **(1 click)**
5. Hit Submit. **(1 click)**

**Total: ~6 clicks for 3 lines.**

### Persona C — *"New product master never ordered before"*

1. Pick Customer.
2. Quick Start band has no matches → click **+ New line** (rightmost tile).
3. Inline mini-wizard opens *inside the cart card*:
    - Pick Product Master (search-as-you-type)
    - Pick size
    - Pick catalog axes (POD, inner-pack, outer-pack — V3.3 catalog dropdowns; only the axes the master declares)
    - Set quantity + price
4. Save line.
5. Repeat or Submit.

**Total: ~8 clicks for the cold-start case** — same as today, but now it's one of three paths instead of the only path.

---

## 4. The line editor (mini-wizard, expanded)

Click `[Edit axes]` on any cart line — that line expands inline to a one-screen editor:

```
┌─ Line 1 — PM-DRY-PET-LD · SNK-250 · 1000 KG ────────────────[Cancel] [Save] ┐
│                                                                              │
│  PRODUCT MASTER                                                              │
│  ┌─ PM-DRY-PET-LD ─ Dry Fruit Standup Pouch ─────────────────[Change]──┐   │
│  │  POUCH · 3 layers · 3 sizes · ROTO printable                          │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  AXES                                                                        │
│  Size:               [ SNK-100  ●SNK-250  SNK-500 ]                          │
│  Layer thicknesses:  [12, 20, 50] μ           Override?                      │
│  Layer grades:       [—, —, FOOD-A]           Override?                      │
│  Add-ons:            [ ZIPPER  □TEAR  □VALVE ]                               │
│                                                                              │
│  CATALOG-BACKED AXES   (V3.3 — values from catalog, BOM auto-derived)        │
│  POD film:           [POD-220-30U-GP ▾]   stock 500 KG · auto-demand fires  │
│  Inner pack:         [INNER-POUCH-24 ▾]   42 pcs needed · stock 1200 ✓      │
│  Outer pack:         [GUNNY-25KG ▾]       counted on packing yard            │
│                                                                              │
│  ARTWORK / PRINT                                                             │
│  Artwork:            [○DEFER  ●DF-ALMOND  ○Pick another...]                  │
│  Print type:         [●ROTO  ○FLEXO]      Cylinder: required                 │
│                                                                              │
│  QUANTITY + PRICE                                                            │
│  Qty:     1000 [KG ▾]    Price: ₹312.00 / KG    Line total: ₹3,12,000        │
│                                                                              │
│  ┌─ BOM PREVIEW ─────────────────────────────────────────────────────────┐  │
│  │ pod_variant       POD-220-30U-GP    1000 pcs       auto-demand        │  │
│  │ packaging_inner   INNER-POUCH-24    42 pcs         stock OK           │  │
│  │ packaging_outer   GUNNY-25KG        — counted —                       │  │
│  └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

When collapsed, the same line shows just the title row + summary chips. Click anywhere on the collapsed row to expand. Only one line is expanded at a time.

---

## 5. State model

```ts
type SalesOrderLine = {
  id: string                                  // local-only UUID until saved
  product_master: string                      // PM ID
  template_id: string | null
  size_code: string
  layer_values: Record<number, LayerRowState> // indexed by layer position (1..N)
  addons: string[]
  axis_values: Record<string, any>            // catalog-backed axes flatten in here
                                              //   { pod_variant: "POD-220-30U-GP",
                                              //     packaging_inner: "INNER-POUCH-24",
                                              //     packaging_outer: "GUNNY-25KG" }
  artwork_mode: "DEFER" | "ASSIGNED"
  artwork_assignment?: ArtworkAssignment
  print_type: "FLEXO" | "ROTO"
  film_type: "SHEET" | "TUBING"
  qty_value: number
  qty_uom: "KG" | "PCS"
  unit_price: string
  price_basis: "KG" | "PCS"
  remarks: string
  // Derived (recomputed on each render):
  bom_lines?: CatalogBomLine[]
  preview_blockers?: string[]
}

type SalesOrderDraft = {
  customer: string
  ship_to_customer: string
  order_name: string
  delivery_date: string
  remarks: string
  lines: SalesOrderLine[]
  expanded_line_id: string | null
}
```

**Hooks:**
- `useSalesOrderDraft()` — reducer with actions: `ADD_LINE`, `REMOVE_LINE`, `DUPLICATE_LINE`, `UPDATE_LINE`, `EXPAND_LINE`, `COLLAPSE_ALL`, `LOAD_FROM_REPEAT`, `LOAD_FROM_PRESET`.
- `useQuickStartItems(customerId)` — returns `{ lastOrders, savedPresets }` from `salesService.getRecentOrdersFor(customerId)` and `presetService.list(customerId)`.
- `useLineBomPreview(line)` — calls `productMasterService.resolveCatalogBom()` per line, debounced.

---

## 6. Submit flow

The current `salesService.createOrder()` already accepts `items: SalesOrderLine[]`. The new draft maps directly:

```ts
salesService.createOrder({
  customer: draft.customer,
  ship_to_customer: draft.ship_to_customer || draft.customer,
  order_name: draft.order_name || `Order ${today}`,
  delivery_date: draft.delivery_date,
  remarks: draft.remarks,
  items: draft.lines.map(line => ({
    product_master: line.product_master,
    template_id: line.template_id,
    axis_values: {
      size: line.size_code,
      addons: line.addons,
      ...line.axis_values,                        // catalog-backed axes
      layer_thicknesses: extract(line.layer_values, 'thickness_micron'),
      layer_grades: extract(line.layer_values, 'grade'),
      layer_widths: extract(line.layer_values, 'width_mm'),
    },
    qty_value: line.qty_value,
    qty_uom: line.qty_uom,
    price_basis: line.price_basis,
    unit_price: line.unit_price,
    printing: line.print_type ? {
      enabled: true,
      print_type: line.print_type,
      film_type: line.film_type,
      defer_artwork_to_planner: line.artwork_mode === "DEFER",
      artwork_id: line.artwork_assignment?.artwork_id,
      cylinder_required: line.print_type === "ROTO",
    } : { enabled: false },
    remarks: line.remarks,
  }))
})
```

**Backend is unchanged** for the multi-line cart itself — it already handles `items: []`. The catalog-backed BOM resolution (V3.3) is what adds the new server work; that's covered in the V3.3 handoff doc.

---

## 7. Validation + footer

The sticky footer reflects per-line + cart-level validation:

```
Cart: 3 lines · 3,400 KG · ₹7,48,800

✓ Customer assigned
✓ All lines have product master + size
⚠ Line 2 — POD stock short by 200 pcs (auto-demand will fire on submit)
✓ Promised dispatch set to Apr 28

[Save draft]  [Submit ➜]
```

Submit is enabled when all lines pass mandatory checks. Warnings (like "auto-demand will fire") don't block submit — they're informational.

---

## 8. Quick Start band — what feeds it

Three sources, in priority order:

### 8.1 Last orders by this customer

`salesService.getRecentOrdersFor(customerId, limit=5)` returns lines from the last 90 days, deduplicated by `(product_master, size, axis_signature)`. Each becomes a card titled with the most-recent order's display info.

### 8.2 Saved presets visible to this customer

`presetService.list({ customer: customerId })` returns presets whose `target_customer` is the current one or empty (global presets). Mark "Most used" (≥10 uses) with a sparkle icon.

### 8.3 Customer overlay defaults

If the customer has an active `CustomerProductOverlay` with `axis_values` populated, surface it as one card titled *"Customer default — {overlay.customer_item_code}"*.

If all three sources are empty, the band hides itself and the user starts from `+ New line`.

---

## 9. Right rail — three sticky panels

The right rail stays at 380–400 px, sticky, scrollable. It surfaces context for **the currently expanded line** (or the cart total when nothing is expanded):

1. **Order anatomy** — the existing `<ProductVisual>` showing the pouch/roll geometry, layers, addons. Updates live as the user edits axes.
2. **Catalog BOM preview** — the same `<CatalogBomPreview>` from V3.3, but now operates on the expanded line. When nothing is expanded, shows aggregated preview across all lines.
3. **Live BOM rail** — the existing `<LiveBomRail>` showing material totals + matching stock pools.

When the cart has multiple lines and none is expanded, the right rail flips to a **cart summary mode**: per-line one-row digest, no detail.

---

## 10. Removed from today's screen

- The 6-step strip (`<StepStrip>`).
- The "Pick a Product Master to start" empty state — the master is picked inside the line editor now.
- The single-line section cards (Customer / Product Master / Pick axes / Quantity / Artwork / Review). Replaced by the customer hero + cart + line editor.
- The `Save as preset` ghost button at the footer — moved to a per-line `Save as preset` action inside the line editor (so users save the *line they just configured* as a preset for next time).

---

## 11. Implementation phases

Land in three PRs so each is reviewable:

### PR 1 — Multi-line cart shell

- Create the new state model (`useSalesOrderDraft`).
- Replace the single-line page body with `<Cart>` + `<LineCard>` + `<LineEditor>` components.
- Each `<LineCard>` is collapsed by default, has Edit / Duplicate / Remove / Expand affordances.
- The first line auto-expands when added.
- Submit collects all lines and calls existing `salesService.createOrder({items})`.
- **No Quick Start band yet** — user must click `+ New line` for the first line.
- Validation + sticky footer added.
- Right rail updated to track expanded line.

Acceptance: A 3-line order can be placed end-to-end with the existing fields. Console clean. `tsc` clean.

### PR 2 — Quick Start band

- Add `<QuickStartBand>` between the customer hero and the cart.
- Implement `useQuickStartItems(customerId)`.
- Three card types: **last-order**, **preset**, **overlay-default**.
- Each card has a `+ Add line` button that fires `LOAD_FROM_REPEAT`/`LOAD_FROM_PRESET` action.
- The band hides when customer is unset or no items are found.

Acceptance: Persona A flow works in 3 clicks (Customer → +Add line → Submit).

### PR 3 — Catalog axes inside the line editor

- Inside `<LineEditor>`, render a section *Catalog-backed axes* that loops over the master's `variant_axes` filtered by `master_data_source`.
- Each axis renders a Select sourced from `masterDataService.getPodSkuVariants` or `getPackaging` (already wired).
- Default value taken from `axis.default_value`, with override.
- Live `<CatalogBomPreview>` inline below the axes.
- Sales submit payload puts axis values into the line's `axis_values` map.

Acceptance: A line with `pod_variant`, `packaging_inner`, `packaging_outer` filled in produces a BOM preview that lists 2-3 lines with auto-demand badges. Submit round-trips correctly.

### PR 4 (optional polish)

- Save-as-preset on the line editor.
- Repeat-order rail surfaces customer overlay axis defaults too.
- Bulk import lines from CSV (paste a list of master codes + qtys → creates N lines).

---

## 12. Acceptance criteria across all PRs

A change is **done** when:

- [ ] Picking a customer with prior orders auto-shows Quick Start band with ≥1 card.
- [ ] Clicking `+ Add line` on a Quick Start card materialises a fully-filled line in the cart in <500 ms.
- [ ] Cart supports 1–N lines; each can be expanded, edited, duplicated, removed independently.
- [ ] Per-line BOM preview updates live as axes change.
- [ ] Sticky footer always shows correct cart totals and validation summary.
- [ ] Submit creates one Sales Order with N items in `items: []`.
- [ ] All catalog-backed axes (`pod_variant`, `packaging_inner`, `packaging_outer`) round-trip from line editor → submit → backend.
- [ ] Existing single-line orders still submit cleanly (regression: a one-line cart behaves identically to today's submit).
- [ ] `npx tsc --noEmit` clean. Zero console errors. All 9 routes 200.
- [ ] Persona A (repeat order) finishes in 3 clicks. Persona B (3-line mixed cart) finishes in ~6 clicks.

---

## 13. Out of scope (future)

- Quotation flow (quotation → order conversion uses similar cart model but separate page).
- Bulk-import wizard with CSV.
- Customer-portal self-serve order placement (different security model).
- Retail-direct flow (currently every order is B2B).

---

## 14. Why this beats today's wizard

| Today | V3.4 |
|---|---|
| Same number of clicks regardless of "is this a repeat or new" | Repeat = 3 clicks; new = 8 clicks; mixed = 6 clicks |
| Multi-line orders not possible (one item per submit) | Multi-line is the default cart |
| Saved presets are decorative on the master | Saved presets are click-to-add on the cart |
| BOM preview lives in the right rail only on the spec step | BOM preview is per-line, always visible inside the line editor |
| Auto-demand for POD/inner-pack stock shortfalls invisible until backend creates them | Auto-demand badges in the BOM preview before submit |
| No way to reuse last order's exact configuration | Quick Start band shows last 3 orders, click-to-clone |

End of design.

# Product Master V3.4 — Stop-Step Model + Removing BULK Kind

> **Audience:** Codex implementation agent.
> **Status:** Design doc. No code changes ship from this doc — separate PRs will execute it.
> **Predecessor:** Builds on `product_master_v33_backend_handoff.md` (axis-level catalog linkage). This doc layers in the stop-step / generic-WIP model and removes the now-redundant `BULK` kind.

---

## 1. The TL;DR

> **There is no separate "BULK" Product Master.** Generic / WIP / pre-printed stock is just **stock pooled at an earlier stop step of the SAME Product Master that owns the final pouch (or roll, or POD)**. The Stock Launcher already supports `stop_step_index` and per-layer axis values — those two together define what the WIP roll is, how wide it is, what it weighs, and what BOM produced it.

The mental shift:

| Old (V3.3) | New (V3.4) |
|---|---|
| `product_kind = BULK` was a separate master family | A pool can be "generic" against ANY master by stopping its route early |
| Sales picker filters out BULK kind | Sales picker is unchanged — every PM is a final-product PM |
| User had to choose: "is this a final pouch or a bulk laminate?" when creating a master | User just creates one PM per finished good. Generic / pre-printed / WIP is just where the planner stops the route |
| BULK kind consumers card on detail right rail | Replaced with "Stock pools at this stop step" rail (filtered by `stop_step_index`) |

---

## 2. The user's question — answered

> *"Generic demand creates from Stock Launcher. But without roll width and KG at stop step, you can't compute the math of consumption or BOM for the WIP roll. Does that come from the master axes selected, or from somewhere else?"*

**Answer: from the axes selected at Stock Launcher time. Master defaults seed them; the planner can override.**

Concretely, when the planner launches a generic stock order against `PM-DRY-PET-LD` and stops at step 3 (Lamination):

1. They pick the master.
2. The Stock Launcher already surfaces the **axis builder** — it pre-fills layer thicknesses, grades, widths from the master's `layer_template` defaults.
3. They edit any axis they want to lock for this batch:
    - `layer_thicknesses: [12, 20, 50]` (μ per layer)
    - `layer_grades: [—, —, FOOD-A]`
    - `layer_widths: [1050, 1050, 1050]` (mm slit width of each layer's roll)
    - `artwork_mode: DEFER` (or pick `DF-ALMOND` if pre-printed)
4. They set **target quantity + UOM** (e.g. 500 KG).
5. They set **stop_step_index** (e.g. 3 = end of Lamination).

That tuple `(master, stop_step, axis_values, qty, uom)` is **everything BOM math needs**:

```
For each layer with thickness T (μ), grade G, width W (mm):
    running_length_m  = qty_kg / (W * 1e-3 * T * 1e-3 * density(G))
    layer_consumption = (1 + waste_factor(step, G)) * running_length_m * W * 1e-3 * T * 1e-3 * density(G)

Output roll spec:
    width_mm           = max(layer_widths) (after lamination, all layers are co-laminated to that width)
    finished_thickness = sum(layer_thicknesses)
    grade              = derived from layer_grades
    qty_kg             = target_qty_kg (after waste accounted)
    qty_meters         = running_length_m
    qty_pcs            = N/A unless this is a pouch step
```

So:
- **Roll width** comes from `layer_widths` axis (slit width). Defaults to master's `layer_template.default_input_roll_width_mm` or to the size's `roll_width_mm`.
- **Kg** comes from `qty_value` + `qty_uom`.
- **Density / waste / yield** come from the master-data film catalog (`FilmVariantGrade`) keyed by `(film_variant_code, grade)` — already exists on the backend.
- **Output identity (the WIP roll's variant code)** is computed deterministically: `PM-DRY-PET-LD-LAM-1050-77U-FOODA` (where `LAM` = stopped at lamination, `77U` = sum of layer thicknesses, etc.). The matcher uses this code + invariant_signature to know which sales orders it can satisfy.

If the planner doesn't override, the master defaults are used — that's why the master's `layer_template` exists. **The master is the recipe; axes parametrize it; stop_step says how far to push it.**

---

## 3. The model in pictures

### One PM → many stock pools

```
                    PM-DRY-PET-LD
                         │
                         │ (route template)
                         ▼
   ┌────────────┬────────────┬────────────┬────────────┐
   │  Step 1    │  Step 2    │  Step 3    │  Step 4    │
   │ Extrusion  │  Printing  │ Lamination │  Pouching  │
   │            │ (artwork)  │            │            │
   └────────────┴────────────┴────────────┴────────────┘

Pool A — stop after step 1                  ← bare extruded film rolls
Pool B — stop after step 2 (artwork=DF-A)   ← printed top web only
Pool C — stop after step 3 (artwork=DEFER)  ← generic laminated roll
Pool D — stop after step 3 (artwork=DF-A)   ← pre-printed laminated roll
Pool E — stop after step 4                  ← finished pouches

ALL FIVE POOLS LIVE UNDER PM-DRY-PET-LD.
The only differences are: stop_step_index + which axes are committed.
```

### Sales matching cascade

```
Order arrives:  SNK-250  ·  FOOD-A  ·  DF-ALMOND  ·  ZIPPER  ·  1000 KG

   Pool E (finished pouches matching exact tuple) ──→ allocate first
   Pool D (laminated + DF-ALMOND artwork)          ──→ allocate next, run step 4 only
   Pool C (laminated, no artwork)                  ──→ allocate next, run step 2 + 4
   Pool B (printed top web, DF-ALMOND)             ──→ allocate next, run step 3 + 4
   Pool A (extruded layer rolls)                   ──→ last resort, run step 2 + 3 + 4

If still short → fire production order against PM-DRY-PET-LD from step 1.
```

The matcher uses `invariant_signature` to know two pools are interchangeable. Two pools can have different PM IDs but the same signature (rare, deliberate cross-PM share — e.g. two pouch families that share a laminate recipe).

---

## 4. Concrete walkthrough — dry fruit pouch, 3 layers, 3 sizes, printing enabled

Setup:

```
PM-DRY-PET-LD
  layers:
    L1 print-web   PET-12         12μ
    L2 barrier     MET-BOPP-20    20μ
    L3 sealant     LD-PE-50       50μ  (FOOD-A or GP)
  sizes:
    SNK-100 (100×150×30 mm, roll_width=1050)
    SNK-250 (140×210×35 mm, roll_width=1050)
    SNK-500 (180×280×45 mm, roll_width=1050)
  axes (V3.3 catalog-backed):
    pod_variant       (catalog: pod_sku_variant)
    packaging_inner   (catalog: packaging_material/INNER_POUCH)
    packaging_outer   (catalog: packaging_material/GONNY)
  route template:
    1 Extrusion (BULK→ROLL)
    2 Printing  (ROLL→ROLL, artwork-bearing)
    3 Lamination (ROLL→ROLL)
    4 Pouching  (ROLL→BULK)
```

### Planner pre-builds inventory

**Friday afternoon, planner thinks:** "Acme's monthly DF-ALMOND order is coming, and three other customers want generic FOOD-A laminate this month. Let me batch it."

She opens **Stock Launcher**:

#### Stock order #1 — pre-printed laminated roll

```
Master:        PM-DRY-PET-LD
Mode:          ARTWORK_LOCKED
Stop step:     3 (Lamination)
Axes:
  layer_thicknesses: [12, 20, 50]
  layer_grades:      [—, —, FOOD-A]
  layer_widths:      [1050, 1050, 1050]
  artwork_mode:      DF-ALMOND   (committed)
Target qty:    800 KG
UOM:           KG
Output type:   ROLL
Stock owner:   Internal
```

System derives:
- Variant code → `PM-DRY-PET-LD-LAM-1050-77U-FOODA-DFALMOND`
- Running length ≈ 56,725 m (pulled from density math above)
- BOM lines for steps 1+2+3:
    - L1 PET-12 input: `1.06 × 56725 m × 1050mm × 12μ × 1.4 g/cm³` = ≈ 1010 KG (with 6% waste)
    - L2 MET-BOPP-20 input: ≈ 1.07 × 56725 × 1050 × 20μ × 1.39 g/cm³ ≈ 1690 KG
    - L3 LD-PE-50 FOOD-A input: ≈ 1.05 × 56725 × 1050 × 50μ × 0.92 g/cm³ ≈ 2780 KG
    - Adhesive lines from lamination recipe
    - Cylinder/plate references for printing (artwork DF-ALMOND)

The 800 KG output is the **net laminated roll qty** at the end of step 3. Material plan above describes everything pulled from inventory or from sub-stock-orders.

#### Stock order #2 — generic laminated, no artwork

```
Master:        PM-DRY-PET-LD
Mode:          GENERIC
Stop step:     3 (Lamination)
Axes:
  layer_thicknesses: [12, 20, 50]
  layer_grades:      [—, —, FOOD-A]
  layer_widths:      [1050, 1050, 1050]
  artwork_mode:      DEFER       ← key difference
Target qty:    1500 KG
UOM:           KG
Output type:   ROLL
```

System derives:
- Variant code → `PM-DRY-PET-LD-LAM-1050-77U-FOODA-DEFER`
- Same recipe math, just no cylinder/plate consumption (no artwork printed yet).

This pool can satisfy ANY DF-* artwork order downstream — printing happens lazily when a sales order pulls from this pool.

### Sales order arrives Monday

```
Acme Foods · SNK-250 · 1000 KG · FOOD-A · DF-ALMOND · ZIPPER addon · INNER-POUCH-24
```

Resolver builds the pouch tuple, then walks pools:

```
Pool E (finished SNK-250 DF-ALMOND ZIPPER pouches):  0 KG     skip
Pool D (laminated DF-ALMOND FOOD-A 1050 77μ):        800 KG   ALLOCATE 800 → still 200
Pool C (generic laminated FOOD-A 1050 77μ):          1500 KG  ALLOCATE 200 → satisfied
   (this 200 KG will route through step 2 with DF-ALMOND artwork on its way to pouching)

Catalog-backed axes (V3.3):
   packaging_inner = INNER-POUCH-24
       qty_formula: ceil(1000_pouches / 24) = ceil(41.67) = 42 inner pouches
       Stock pool for INNER-POUCH-24:  1200 pcs available  ALLOCATE 42 → satisfied
   packaging_outer = GUNNY-25KG
       qty: counted on packing yard (qty_per_pcs=0)  → no auto-allocation

Sales order line attached to:
   Stock #2 (Pool D): 800 KG    → step 4 only
   Stock #3 (Pool C): 200 KG    → steps 2 + 4
   Pkg pull: 42 INNER-POUCH-24
   FG output: 1000 KG SNK-250 DF-ALMOND ZIPPER
```

Production schedules:
- 800 KG go through step 4 (Pouching)
- 200 KG go through step 2 (Printing with DF-ALMOND) → step 3 (Lamination — already done? No, this 200 KG is from generic laminate which is post-step 3) → wait that doesn't work. **Correction:** Pool C is post-lamination. Printing usually happens before lamination. To pull from Pool C with a different artwork, the planner has to either reverse-print on the laminate (rare) or accept that Pool C is "no artwork ever" and only useful for back-print or cylinder-less orders.

This is exactly why the matcher must understand which steps are reversible. In our system:
- `artwork_step` is fixed at step 2 in this template.
- A pool past step 3 with `artwork_mode = DEFER` cannot have artwork printed afterward (the artwork-bearing layer is now sandwiched between barrier and sealant).
- So the matcher actually rejects Pool C for this order. The remaining 200 KG triggers a production order from step 1.

Updated allocation:
```
Pool D: 800 KG    → step 4 only
Production from step 1 for 200 KG (full route)
```

The point: **the math, the matching, and the production scheduling all derive from the master's route template + the pool's stop_step + the axis tuple**. No BULK kind needed.

---

## 5. What changes in the UI

### Create modal (`product-master-create-modal.tsx`)

| Today | After |
|---|---|
| Kind picker has 6 tiles: POUCH / ROLL / PACKAGING / POD / **BULK** / OTHER | Drop the BULK tile entirely |
| BULK shows a special info banner | Banner removed |
| Reporting group auto-suggests `LAMINATED` for BULK | Branch removed |

The kind picker becomes 5 tiles:

```
Finished pouch    │  Roll / film       │  Packaging
POD               │  Other
```

### Detail workspace (`product-master-detail.tsx`)

| Today | After |
|---|---|
| `isBulk` hides Customer overlays / Artworks / Saved presets tabs | Remove `isBulk` checks; all kinds show all tabs |
| BULK kind right-rail "Used by / consumers" card | Move to a **conditional** that shows for ANY master where `listConsumers` returns ≥1 row (i.e. used as upstream by some other master) |
| Hero KPI chips swap to "Consumers / Stock pools" for BULK | Standard KPI chips for all kinds |
| Catalog-backed axes section (V3.3) — only on POUCH/ROLL/OTHER | Same — unchanged |

### Sales workspace (`sales-order-v3-workspace.tsx`)

| Today | After |
|---|---|
| Master picker filters with `for_sales: true` (excludes BULK) | Filter is now redundant; can be removed or left in as a no-op safety net |

### Stock Launcher (`stock-launcher-workspace.tsx`)

**No structural change.** The launcher already has:
- Master picker → reads PM
- Mode picker → GENERIC / CUSTOMER / ARTWORK / CUSTOMER_ARTWORK / PACKAGING / POD
- Commitment scope selector
- Route timeline → start_step + stop_step
- Axes builder → layer thicknesses, grades, widths
- Stock pool preview, BOM-by-step, matching demand

**One copy change:** The `LaunchModeGrid`'s `GENERIC` tile description should say:
```
GENERIC — make WIP that any compatible sales line can pull.
        Stop the route mid-way (extrusion, printing, or lamination).
        Defer artwork and customer to maximize reuse.
```

That's it. The capability already exists.

### Mock seed (`services/product-master.ts`)

Drop `pm-bulk-laminate`. The `pm-pod-ldnat` and `pm-inner-pack-ld` seeds **stay** — they're recipes for in-house POD and inner-pack production, not generic WIP. They're consumed via V3.3 catalog-backed axes, not via this stop-step pattern.

### Backend

Drop the `BULK` literal from the `ProductKind` enum on the Django side **only if no production data uses it**. If existing data has BULK rows, keep the enum value but mark deprecated and stop offering it in the create form.

The `for_sales` filter on `/api/master/products/` becomes a no-op for new data but should keep working for legacy.

The Stock Launcher backend already supports `stop_step_index` — confirm.

The **matching engine** is the real backend work this doc unblocks. Spec:

```python
def match_pools_for_order_line(order_line) -> list[StockPoolMatch]:
    """
    Walk the order line's variant tuple, find compatible pools, return them
    in priority order (most-finished first). Stops at first allocation that
    fulfills the requirement.
    """
    matches = []
    pm = order_line.product_master
    axis_values = order_line.axis_values
    target_qty = order_line.qty_kg

    # 1. Try finished-pouch pool (stop_step = terminal)
    matches.extend(query_pools(pm=pm, stop_step=pm.terminal_step, axis_values_match=axis_values))

    # 2. Walk back through earlier stop steps. For each stop step, try pools
    #    whose locked axes are compatible (subset of order's axes) and whose
    #    deferred axes don't conflict with later steps.
    for step_idx in range(pm.terminal_step - 1, 0, -1):
        if step_idx < pm.terminal_step:
            # Only step types after which downstream production CAN re-add
            # missing axes are eligible. E.g. you can't add artwork to a
            # post-lamination roll if artwork happens at step 2.
            if not pm.is_step_eligible_for_pool_reuse(step_idx, axis_values):
                continue
            matches.extend(query_pools(pm=pm, stop_step=step_idx, axis_subset_match=axis_values))

    # 3. Cross-PM: any pool from another PM with same invariant_signature
    #    and a stop_step in this PM's compatible step range.
    matches.extend(query_pools_by_signature(
        signature=pm.compute_invariant_for(axis_values),
        compatible_with_pm=pm,
    ))

    return rank_and_dedupe(matches)
```

The `is_step_eligible_for_pool_reuse` check is the rule that prevents the "post-lamination + DEFER artwork → DF-ALMOND order" mismatch I described above. Each route template declares which steps **add** which axes; pools at step N can only feed orders that don't require an axis added by a later step.

---

## 6. Migration plan

| Step | Frontend | Backend | Data |
|---|---|---|---|
| 1. Drop BULK from create modal | `KIND_CARDS` array | — | — |
| 2. Drop `pm-bulk-laminate` seed | `STATE.masters` array in service | — | — |
| 3. Remove `isBulk` branching | `product-master-detail.tsx` | — | — |
| 4. Update Stock Launcher GENERIC tile copy | `launch-mode-grid.tsx` | — | — |
| 5. Update sales picker filter to be a no-op | `sales-order-v3-workspace.tsx` | — | — |
| 6. Update backend `ProductKind` choices | — | `apps/recipes/models.py` | — |
| 7. Existing BULK PMs (if any) | — | — | One-time SQL migration to convert to nearest finished-product PM, or leave isolated with a `legacy_bulk_kind=True` flag |
| 8. Implement matcher for cross-PM signature reuse | — | `apps/production/matcher.py` | — |
| 9. Implement step-eligibility check | — | `apps/recipes/route_eligibility.py` | — |

Steps 1–5 ship as one PR. Step 6 ships when backend confirms no live data uses BULK or after step 7 migration. Steps 8–9 are the meaty backend work for the matcher; they're independent and can land later.

---

## 7. Why this is better than V3.3

V3.3 already had `BULK` as a separate kind. That worked but had three problems:

1. **Cognitive overhead.** Users had to think about whether a master was "real" or "internal WIP". For 90% of cases that was wrong — the same master can be both, depending on how far you push it down the route.
2. **Duplicated layer recipes.** A BULK master and a pouch master with the same layer template + grades would be two separate records. Two registries to keep in sync. Bug-prone.
3. **No expressivity for partial finishes.** BULK was just one extra category. With stop-step, you get five (or however many steps the route has) gradations for free.

V3.4 collapses all of that into the stop-step axis. The route template is the source of truth for which intermediate states exist, and any of them can be stockpiled by the planner.

---

## 8. Acceptance criteria

A change implementing this doc is **done** when:

- [ ] Create modal kind picker has exactly 5 tiles (no BULK).
- [ ] `pm-bulk-laminate` seed is removed; routes still 200.
- [ ] `/master/products/pm-pod-ldnat` and `/master/products/pm-inner-pack-ld` still render (those seeds stay).
- [ ] All other masters (POUCH/ROLL/POD/PACKAGING/OTHER) show all 7 tabs (no per-kind hiding).
- [ ] `Sales create` master picker shows every active master regardless of any old `for_sales` filter.
- [ ] Stock Launcher `GENERIC` mode tile says "Stop the route mid-way" in the description.
- [ ] No console errors. `npx tsc --noEmit` passes.
- [ ] Backend migration plan documented (step 7) — but doesn't have to ship in the same PR as the frontend.

---

## 9. Open question

**Should the BULK enum value disappear from `ProductKind` entirely, or be kept as `legacy`?**

Default recommendation: keep the enum value for one release cycle, hide it from the create UI, and remove after confirming no live BULK records exist or after migrating them. This lets the matcher's "any pool by signature" path discover and gracefully include legacy BULK pools without choking.

End of design.

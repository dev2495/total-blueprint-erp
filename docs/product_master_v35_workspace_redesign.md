# Product Master Workspace — V3.5 Redesign (Mockup)

> **Audience:** Codex implementation agent + product owner.
> **Status:** Design mockup. **No code changes ship from this doc.**
> **Predecessors:**
> `product_master_v33_backend_handoff.md` (axis-level catalog linkage)
> `product_master_v34_stop_step_model.md` (stop-step / no BULK kind)
> `sales_order_v34_create_redesign.md` (multi-line cart sales)
>
> **Goal:** Reimagine `/master/products/[id]` as one stunning, single-canvas workspace. No tabs. Side rail navigation. Every axis visualised. The master IS the recipe; the page lets you read it, edit it, simulate it, and watch it live.

---

## 1. North star

Open the page → understand the master in **5 seconds** → make any change in **2 clicks** → simulate any sales line in **3 clicks** → see live stock health without leaving the page.

Three personas:

| Who | Wants |
|---|---|
| **Sales lead** | "Will my customer's preferred config produce a valid variant?" — wants the configurator simulator. |
| **Planner** | "What's stockable, what's running short?" — wants the route map + stock health. |
| **Master owner (engineering / pricing)** | "Edit the recipe, validate downstream impact." — wants the axis dashboard + edit mode. |

The redesign serves all three from **one screen** without tabs.

---

## 2. The layout (one canvas, sticky side rail)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ STICKY HEADER                                                                            │
│ [Logo · Master code]  Dry Fruit Standup Pouch · PET/LD          [Edit] [Save] [Activate] │
│ KIND POUCH · 4 STEPS · 9 AXES · 8 OVERLAYS · 3 SIZES · ACTIVE                            │
│ [Sales sim ➜]  [Planner sim ➜]  [Open in Stock Launcher]                                 │
└──────────────────────────────────────────────────────────────────────────────────────────┘
┌────────────────┬──────────────────────────────────────────────────────────────┬──────────┐
│ SIDE RAIL      │ MAIN CANVAS                                                   │ INSIGHT  │
│ (sticky nav)   │                                                               │ RAIL     │
│                │                                                               │ (sticky) │
│ ● Header       │ [PANEL: Header]                                               │          │
│ ● Route map    │   master code, kind, template, reusable policy, …            │ Health   │
│ ● Sizes        │                                                               │ donut    │
│ ● Layer stack  │ [PANEL: Route map] ← centerpiece                              │          │
│ ● Axes         │   visual route diagram with stock pools per stop step        │ Match %  │
│ ● Variants     │                                                               │ today    │
│ ● Overlays     │ [PANEL: Sizes] ← editable size table                          │          │
│ ● Stock        │                                                               │ Last 90d │
│ ● Activity     │ [PANEL: Layer stack]                                          │ heat-    │
│                │                                                               │ map      │
│ Sticky scroll  │ [PANEL: Axes] ← gallery of axis cards                         │          │
│ spy.           │                                                               │ Top      │
│                │ [PANEL: Variants] ← matrix view (true 2D)                     │ recent   │
│                │                                                               │ orders   │
│                │ [PANEL: Overlays] ← matrix: customers × axes                  │          │
│                │                                                               │ Linked   │
│                │ [PANEL: Stock health]                                         │ in:      │
│                │                                                               │ presets  │
│                │ [PANEL: Activity]                                             │          │
└────────────────┴──────────────────────────────────────────────────────────────┴──────────┘
```

**No tabs.** Side rail is a sticky scroll-spy: click an item → smooth scroll to that panel. Active panel highlights in the rail. Both rails (left nav + right insight) are independently scrollable inside their viewport.

The header is sticky and **collapses on scroll** to a 1-row summary so the workspace can use full vertical real estate.

---

## 3. Panels in detail

### 3.1 Header panel

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  PM-DRY-PET-LD                                                  [Edit master]│
│  ┌─ Identity ─────────────────────────┐ ┌─ Engineering contract ─────────┐   │
│  │ KIND      POUCH                     │ │ TEMPLATE   ROLL_TO_BULK_v3     │   │
│  │ REPORTING  FG                       │ │ STEPS      4 (Extrude → Pouch) │   │
│  │ STYLE      STAND_UP                 │ │ POLICY     CONFIGURABLE         │   │
│  │ ACTIVE     ✓                        │ │ INVARIANT  INV-PM-DRY-PET-LD    │   │
│  └─────────────────────────────────────┘ └─────────────────────────────────┘   │
│                                                                                │
│  Description: Transparent or milky PET/LD laminate for almonds, cashews,       │
│  raisins and trail mix. Same master covers 100g/250g/500g.                     │
│  [Edit description]                                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

Two side-by-side cards: **Identity** (kind, reporting, style, active) and **Engineering contract** (template, steps, policy, invariant). Description below. Single Edit button activates inline edit on this panel only.

### 3.2 Route map panel — the centerpiece

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ROUTE MAP                                                       [Edit route]│
│                                                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ ENTRY    │→ │ EXTRUSION│→ │ PRINTING │→ │ LAMINAT. │→ │ POUCHING │ → END  │
│  │ raw      │  │ BULK→ROLL│  │ ROLL→ROLL│  │ ROLL→ROLL│  │ ROLL→BULK│         │
│  │ films    │  │ ★        │  │ ◇artwork │  │          │  │ ★ final  │         │
│  └──────────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
│                     │             │             │             │                │
│                     ▼             ▼             ▼             ▼                │
│                  Pool A        Pool B        Pool C/D       Pool E             │
│                  generic      printed       laminated     finished pouches     │
│                  (no aw)      (DF-A)        (DEFER or    (sized + sealed)      │
│                                              DF-A)                             │
│                  500 KG       1,200 KG      800 KG         1,000 KG            │
│                  ━━━━━━ 60%   ━━━━━━━ 80%   ━━━━━ 50%      ━━━━━━━ 90%        │
│                                                                                │
│  Click any step or pool to see what variants live there + launch new stock.    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Each step is a card. ★ = artwork-bearing, ◇ = optional, etc.
- Below each step is a **stock pool drawer** showing what's currently pooled at that stop.
- Clicking a pool opens a side drawer (right edge of canvas) showing pool detail + a "Launch new stock at this stop" CTA that pre-fills the Stock Launcher.
- **Edit route** opens the route template editor in a side drawer (re-using the existing template UI).

### 3.3 Sizes panel

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  SIZES (3)                                                       [+ Add size]│
│                                                                                │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │ S1  SNK-100   100×150×30 mm  · roll_w 1050 · 5 trim · gusset 30          │ │
│  │     [● Active]   used by 4 active variants  ·  85 KG/month avg            │ │
│  ├───────────────────────────────────────────────────────────────────────────┤ │
│  │ S2  SNK-250   140×210×35 mm  · roll_w 1050 · 5 trim · gusset 35          │ │
│  │     [● Active]   used by 7 active variants  ·  220 KG/month avg           │ │
│  ├───────────────────────────────────────────────────────────────────────────┤ │
│  │ S3  SNK-500   180×280×45 mm  · roll_w 1050 · 5 trim · gusset 45          │ │
│  │     [○ Active]   used by 2 active variants  ·  60 KG/month avg            │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

Each size row shows usage telemetry (variants count + monthly avg). Inline Edit button per row opens a popover with the geometry fields.

### 3.4 Layer stack panel

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  LAYER STACK · 3 layers · 77 μ total                            [Edit layers]│
│                                                                                │
│   Visual:                                                                      │
│                                                                                │
│   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓     │
│   ┃ L1  PRINT-WEB    PET-12          12 μ                                ┃ ◀── │
│   ┃ ──────────────────────────────────────────────────                  ┃ outer│
│   ┃ L2  BARRIER      MET-BOPP-20     20 μ                                ┃     │
│   ┃ ──────────────────────────────────────────────────                  ┃     │
│   ┃ L3  SEALANT      LD-PE-50        50 μ  · grade FOOD-A | GP            ┃ ◀── │
│   ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛ inner│
│                                                                                │
│   Per-layer overrides allowed:  thickness ✓   grade ✓   width ✓                │
└──────────────────────────────────────────────────────────────────────────────┘
```

Visual stack with color-coded layers (PET = blue, MET-BOPP = silver, LD = green). Overlay shows which axes can override per layer. Click a layer → row inline-edits.

### 3.5 Axes panel — axis gallery

The most-changed panel. Each axis becomes a card:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  AXES · 9 dimensions                                            [+ Add axis] │
│                                                                                │
│  ┌─ size ────────────────┐ ┌─ layer_thicknesses ──────┐ ┌─ layer_grades ────┐ │
│  │ ◆ Required   geometry  │ │   Optional   per-layer  │ │   Optional         │ │
│  │ 3 values:               │ │ 3 layers · default+vary │ │ FOOD-A, GP         │ │
│  │ ● SNK-100               │ │ ┌─ histogram ─┐         │ │ usage 78% / 22%    │ │
│  │ ● SNK-250               │ │ │ 12   ▮      │         │ │                    │ │
│  │ ● SNK-500               │ │ │ 20   ▮      │         │ │                    │ │
│  │                          │ │ │ 50   ▮      │         │ │                    │ │
│  │ usage: 35/55/10 %        │ │ │ 65   ▮▮     │         │ │                    │ │
│  │                          │ │ └─────────────┘         │ │                    │ │
│  └──────────────────────────┘ └──────────────────────────┘ └────────────────────┘ │
│                                                                                │
│  ┌─ pod_variant ─────────┐ ┌─ packaging_inner ─────┐ ┌─ packaging_outer ──┐  │
│  │ Optional · catalog ref │ │ Optional · catalog ref│ │ Optional · catalog │  │
│  │ ↗ PodSkuVariant        │ │ ↗ Packaging (INNER)   │ │ ↗ Packaging (GUNNY)│  │
│  │ qty: 1 × pcs           │ │ qty: ceil(p/24)       │ │ qty: counted floor │  │
│  │ auto-demand ✓          │ │ auto-demand ✓         │ │ auto-demand ✗      │  │
│  │                          │ │                        │ │                     │  │
│  │ Live options (6):        │ │ Live options (4):      │ │ Live options (2):  │  │
│  │ ● POD-220  ◐ 500 KG     │ │ ● INNER-POUCH-24       │ │ ● GUNNY-25KG       │  │
│  │ ● POD-260  ○ 0 KG       │ │ ● INNER-POUCH-12       │ │ ● GUNNY-50KG       │  │
│  │ ● POD-300  ◐ 200 KG     │ │ ● INNER-POUCH-48 ⚠     │ │                     │  │
│  │ + 3 more                  │ │ ● INNER-POUCH-CUSTOM    │ │                     │  │
│  └──────────────────────────┘ └──────────────────────────┘ └────────────────────┘ │
│                                                                                │
│  ┌─ addons ───────────────┐ ┌─ artwork_mode ─────────┐                           │
│  │ Optional · multi_enum  │ │ Optional · enum         │                           │
│  │ ZIPPER · TEAR · VALVE  │ │ DEFER  ●ASSIGNED       │                           │
│  │ usage: 60% have ZIPPER │ │ usage: 70% / 30%        │                           │
│  └──────────────────────────┘ └──────────────────────────┘                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Each axis card surfaces:**
- Required vs optional, axis type
- For numeric axes: histogram of which values are used
- For enum/multi-enum: usage % per option
- For catalog-backed (V3.3): the catalog source, qty formula, auto-demand flag, and a **live options list with stock health icons** (●=in stock, ◐=partial, ○=empty, ⚠=warning)

Clicking the catalog source link (↗ PodSkuVariant) navigates to that catalog page. Clicking a specific option opens a slide-over with that option's stock detail and "launch production" shortcut.

**Add axis** is a side-drawer wizard:
1. Pick kind (geometry / per-layer-number / per-layer-enum / multi-enum / catalog-ref / enum)
2. If catalog-ref: pick catalog source + filter
3. Set required/optional, label, qty formula (if catalog-ref)
4. Save

### 3.6 Variants panel — the matrix view

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  VARIANTS                                                                     │
│  Show as:  [● Matrix]  [○ List]  [○ Tree]                                     │
│  Rows: [size ▾]   Cols: [layer_grades ▾]   Cell: [orders count ▾]             │
│  Filter: ●Active ○Inactive   Used in last [90 days ▾]                         │
│                                                                                │
│  ┌────────────┬───────────┬───────────┬───────────┬───────────┐                │
│  │            │ FOOD-A    │ GP        │ PHARMA    │ (any)     │                │
│  ├────────────┼───────────┼───────────┼───────────┼───────────┤                │
│  │ SNK-100    │  ▰ 12     │  ▰ 8      │  ▱  0     │  ▰▰ 20    │                │
│  │ SNK-250    │  ▰▰ 24    │  ▰ 6      │  ▰  3     │  ▰▰▰ 33   │                │
│  │ SNK-500    │  ▰  4     │  ▱  0     │  ▱  0     │  ▰   4    │                │
│  ├────────────┼───────────┼───────────┼───────────┼───────────┤                │
│  │ (any)      │  ▰▰▰ 40   │  ▰ 14     │  ▰  3     │  ▰▰▰ 57   │                │
│  └────────────┴───────────┴───────────┴───────────┴───────────┘                │
│  Click a cell to drill into the variants in that bucket.                       │
│                                                                                │
│  Or [+ New variant tuple] to manually create one (rare; usually auto).        │
└──────────────────────────────────────────────────────────────────────────────┘
```

A **true 2D matrix view** with selectable row/col axes. Cell shows the metric of choice (orders count / kg consumed / last used / stock available). Heatmap intensity ▱→▰→▰▰▰ shows magnitude.

Three view toggles: Matrix · List · Tree. List is the existing variant table. Tree shows axis combinations as a navigable tree.

Drill down on any cell → side drawer with the actual variants in that bucket.

### 3.7 Overlays panel — customer × axis matrix

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  CUSTOMER OVERLAYS · 8 customers                          [+ Add overlay]    │
│                                                                                │
│           │ size  │ grade │ pod_variant │ packaging_inner │ artwork  │ pcs/inner│
│  ─────────┼───────┼───────┼─────────────┼─────────────────┼──────────┼──────────│
│  Acme     │SNK-250│FOOD-A │ POD-220-30U │ INNER-POUCH-24  │DF-ALMOND │ 24       │
│  Bigbasket│ —     │FOOD-A │ POD-260-30U │ INNER-POUCH-12  │ —        │ 12       │
│  Reliance │SNK-100│ —     │ POD-220-30U │ —               │DF-CASHEW │ —        │
│  …                                                                              │
│                                                                                │
│  Empty cells = use master default. Click any cell to set / unset.              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Customers down rows, axes across cols. Each cell shows the overlay's value for that axis (or "—" if uses master default).

Click a cell → popover with the catalog dropdown / enum / numeric input. Save updates the overlay.

The **+ Add overlay** button opens a row-create dialog: pick a customer (search-as-you-type) → fill any axes → save.

### 3.8 Stock health panel

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  STOCK HEALTH                                                                 │
│                                                                                │
│  ┌─ Donut: demand vs stock ─────────┐ ┌─ Pool list ───────────────────────┐  │
│  │       ╱─────╲                       │ │ Pool A · extruded  500 KG  ●●●●  │  │
│  │     ╱  72%   ╲                       │ │ Pool B · printed   1,200 KG ●●●●●│  │
│  │    │ matched │                       │ │ Pool C · laminated 800 KG  ●●○○○ │  │
│  │     ╲  28%  ╱                       │ │ Pool D · laminat-A 800 KG  ●●●●○ │  │
│  │       ╲need╱                          │ │ Pool E · finished  1,000 KG ●●●●●│  │
│  │       ─────                            │ │                                  │  │
│  │       Last 30d                         │ │ [Launch new stock]               │  │
│  └────────────────────────────────────┘ └────────────────────────────────────┘  │
│                                                                                │
│  Auto-demand triggered today:                                                  │
│  • POD-220-30U-GP   needed 200 pcs   stock 0   → SO-1241 stock launcher fired  │
│  • INNER-POUCH-24   needed 42 pcs    stock 12  → no auto-demand (purchased)    │
└──────────────────────────────────────────────────────────────────────────────┘
```

Donut shows last-30-day demand-vs-stock match rate. Pool list shows current pool size + health stars per stop step. Bottom shows today's auto-demand log (which BOM lines fired stock launchers).

### 3.9 Activity panel

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ACTIVITY · last 90 days                              [Filter: All ▾]         │
│                                                                                │
│   Calendar heatmap (12 weeks × 7 days)                                         │
│   M T W T F S S                                                                │
│   ░ ▓ █ █ ▓ ░ ░       ░ = 0 orders                                             │
│   ▓ █ █ █ █ ▓ ░       ▓ = 1-3 orders                                           │
│   █ █ █▒█ █ ▓ ░       █ = 4+ orders   ▒ = anomaly (sudden spike)               │
│                                                                                │
│  Recent stream:                                                                │
│  • 2h ago    Sales · A.K.Poly · SO-1245 · 1000 KG SNK-250 DF-ALMOND            │
│  • 4h ago    Planner · launched Pool D · 800 KG laminate                       │
│  • 1d ago    Master · axis layer_grades — added PHARMA grade                   │
│  • 2d ago    Overlay · Bigbasket · pcs_per_inner changed 12 → 24               │
│  • 3d ago    Stock · POD-220 production order completed · +500 KG              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Calendar heatmap of orders + a kind-aware activity stream (Sales, Planner, Master, Overlay, Stock). Filter by event type.

---

## 4. The right insight rail (sticky)

Always visible. Three compact panels:

### 4.1 Health donut (above)
Already covered.

### 4.2 Configurator simulator (the killer feature)

```
┌─ SIMULATOR ─────────────────────────────────────────┐
│ Pretend you're sales — pick axes, see what happens. │
│                                                      │
│ Customer: [Acme ▾]  ← pre-fills overlay defaults    │
│ Size:     [SNK-250 ▾]                               │
│ POD:      [POD-220-30U-GP ▾]                        │
│ Inner:    [INNER-POUCH-24 ▾]                        │
│ Artwork:  [DF-ALMOND ▾]                             │
│ Qty:      [1000 KG]                                 │
│                                                      │
│ ──────────── Result ────────────                    │
│ ✓ Variant code:                                      │
│   PM-DRY-PET-LD-SNK250-FOODA-DFALMOND-ZIP            │
│ ✓ Existing variant — used 24× in last 90d            │
│ ✓ BOM:                                               │
│   • POD-220-30U-GP    1000 pcs (auto-demand if short)│
│   • INNER-POUCH-24    42 pcs                         │
│   • GUNNY-25KG        — counted on packing yard      │
│ ✓ Stock health:                                      │
│   ● Pool D 800 KG covers 80%  ● rest from production │
│                                                      │
│ [Save as preset]  [Open in Sales Create →]          │
└──────────────────────────────────────────────────────┘
```

Persona A (sales lead) lives here. Type axes, see variant code + BOM + stock health update in real-time. **No leaving the page** to validate. One click to materialize as a Saved Preset, one click to open in the V3.4 Sales Create page with everything pre-filled.

### 4.3 Linked-in (downstream usage)

```
┌─ LINKED IN ──────────────────────────────────────┐
│ Where is this master referenced?                 │
│                                                   │
│ • 8 customer overlays                             │
│ • 3 saved presets                                 │
│ • 5 active sales orders                           │
│ • 2 stock pools                                   │
│ • 1 batch import (template)                       │
│                                                   │
│ [Audit references]                                │
└───────────────────────────────────────────────────┘
```

Quick orientation about how "live" this master is. Click any line → drill-into list.

---

## 5. Edit mode — global, not per-section

Today, each section has its own [Edit] button. Confusing.

V3.5: a single global **Edit** button in the sticky header. Click it once → the whole canvas enters edit mode. Every editable field becomes editable, with inline validation. Header changes to:

```
[Edit] → [✓ Save changes (3)] [Cancel]
```

The (3) is the count of dirty fields. Save sends one PATCH. Cancel reverts.

This is a far better mental model than "edit one section at a time."

---

## 6. What disappears

- **Tabs**. Replaced by side-rail scroll-spy.
- **Per-section Edit buttons**. Replaced by global edit mode.
- **The variant matrix as a list-only view**. Replaced by Matrix / List / Tree toggle, defaulting to Matrix.
- **Customer overlays as a list of cards**. Replaced by customer × axis matrix.
- **Saved presets as a separate tab**. Folded into the Variants panel as a filter ("Show: variants used as presets").
- **Static "Live preview" rail**. Upgraded to the interactive Configurator simulator.
- **The Edit-link/catalog dialog from V3.3**. The Axes panel inline-handles catalog source changes.

---

## 7. What's new

| Feature | Why |
|---|---|
| Side-rail scroll-spy | Replaces tabs; shows where you are; jumps anywhere fast |
| Route map with stock pools | Makes the V3.4 stop-step model real and clickable |
| Axis cards with usage histograms | Engineering and pricing see live demand for each value |
| Variant matrix view | Spot patterns (e.g. "we never sell SNK-500 with PHARMA grade") |
| Customer × axis overlay matrix | Edit overlays in 2 clicks instead of opening a dialog |
| Stock health donut + auto-demand log | Live operations without leaving the master |
| Configurator simulator (right rail) | "Will this work?" answered in 5 seconds |
| Calendar heatmap | Spot anomalies and trends quickly |
| Global edit mode | One mental gear shift, not per-section |
| Linked-in panel | Understand the blast radius of any change |

---

## 8. Visual language carry-over

This redesign reuses the existing primitives:

- **GradientHero** for the sticky header (collapsed mode is a 1-row horizontal version)
- **SectionCardV3** for each main panel — accent colors per section (header=blue, route=violet, sizes=emerald, layers=blue, axes=violet, variants=blue, overlays=amber, stock=emerald, activity=slate)
- **Catalog axis chips** with stock health icons reuse the V3.3 chip pattern
- **The cart's sticky footer pattern** from V3.4 sales — applied to a "dirty fields · Save · Cancel" footer when in edit mode

Color palette is unchanged: Tailwind blue/indigo for primary action, violet/fuchsia for premium/preset, emerald for ok/active, amber for warn, rose for blocker.

---

## 9. Comparison

| Today | V3.5 mockup |
|---|---|
| 7 tabs to navigate | 1 canvas, side-rail nav, no tabs |
| Spec tab = long scroll of 8 sections | Same scroll, but with sticky scroll-spy + collapse-on-scroll header |
| Variant matrix = flat list | Matrix / List / Tree toggle; matrix default |
| Customer overlays = card list | Matrix view with click-to-edit cells |
| Saved presets = decorative tab | Variants filter ("show as preset") |
| Per-section [Edit] buttons | Single global Edit; one-click save all changes |
| Right rail = Live preview (static) | Right rail = Health · Simulator · Linked-in |
| No way to test sales config from master | Configurator simulator answers in 5 sec |
| Stock health buried in Stock Launcher | Stock health on the master page |
| Axis info shown as text only | Axis cards with histograms + live catalog options + stock health |
| No visual route diagram | Route map is the centerpiece, click pools to launch |

---

## 10. Phased implementation (when ready)

**PR 1 — layout shift**
- Replace Tabs with side-rail scroll-spy.
- Convert each existing tab content into an anchored panel.
- No behavior change yet. **(2 days)**

**PR 2 — global edit mode**
- Lift edit state from per-section to a single workspace context.
- Add the dirty-fields footer.
- Migrate each section's editor to consume context. **(2 days)**

**PR 3 — route map panel**
- Build the visual route diagram.
- Wire stock pools per stop step from the planner service.
- "Launch from stop" CTA opens Stock Launcher pre-filled. **(3 days)**

**PR 4 — axis gallery rework**
- Each axis becomes a card with usage telemetry.
- Catalog-backed axes show live options + stock health icons.
- Add-axis side-drawer wizard. **(3 days)**

**PR 5 — variant matrix view**
- Pivot the existing variant table into a true 2D matrix.
- Row/col axis selectors, metric selector, drill-down drawer. **(3 days)**

**PR 6 — overlay matrix**
- Customer × axis grid.
- Click-to-edit cell popovers. **(2 days)**

**PR 7 — configurator simulator**
- Right-rail simulator with live BOM resolution + stock health.
- "Save as preset" + "Open in Sales Create" CTAs. **(2 days)**

**PR 8 — stock health + activity heatmap**
- Donut, pool list, auto-demand log.
- Calendar heatmap of orders. **(2 days)**

**PR 9 — polish**
- Sticky header collapse-on-scroll.
- Linked-in rail.
- Empty states for new masters.
- Final QA. **(2 days)**

**Total: ~21 working days / ~4 weeks for one engineer.**

Phases are independent — PR 1, 2, and 7 give the biggest UX wins for the lowest effort and could ship first.

---

## 11. Acceptance criteria (when implemented)

- [ ] Open any master → side rail visible, scroll-spy active, every panel accessible without click
- [ ] Click an axis card → see live catalog options with stock health icons
- [ ] Click a stock pool in route map → launch new stock with one click
- [ ] Switch variants panel to matrix view → see size × grade matrix populate
- [ ] Click an overlay cell → set/unset the value, save, see the cell update in <500ms
- [ ] Right-rail simulator: enter Acme · SNK-250 · DF-ALMOND → see variant code + BOM + stock match in <300ms
- [ ] Hit Edit in header → all panels go editable, all field-level dirty marks tracked
- [ ] Click Save → one PATCH submits all dirty fields, success toast, edit mode exits
- [ ] Calendar heatmap renders 90 days, click a day → activity stream filters to that date
- [ ] Linked-in panel shows accurate counts of overlays, presets, sales orders, pools
- [ ] On a brand-new master with no axes / sizes / variants → graceful empty states with CTAs
- [ ] All routes 200, `tsc --noEmit` clean, zero console errors

---

## 12. Open design questions

1. **Single canvas vs. progressive disclosure** — collapse panels by default and expand on rail-click? Or always-render? Default: always render (we have screen real estate); collapsing is a power-user toggle.
2. **Inline edit vs. side drawer** — should clicking an axis open a drawer or expand inline? Default: inline for simple edits (toggle, rename), drawer for complex edits (axis kind change).
3. **Mobile** — out of scope for now; this workspace is desktop-first. A read-only mobile view comes later.
4. **History / undo** — does edit mode support undo/redo? Probably yes. Built into the dirty-fields tracking.
5. **Keyboard shortcuts** — `e` enters edit mode, `s` save, `g r` jump to Route panel, `g a` jump to Axes, etc. Vim-style. Power-user only; surface via `?` help overlay.

---

## 13. Why this beats today

- **One screen** instead of 7 tabs reduces context-switch cost.
- **Visual route + stock** replaces "open stock launcher → search master → drill" with one click.
- **Configurator simulator** lets sales validate without opening Sales Create.
- **Matrix views** let pricing/engineering spot patterns and gaps in 2 seconds.
- **Global edit mode** turns "edit 8 sections" into "edit master, save."
- **Catalog-backed axis cards** make V3.3 visible and operational.
- **Stop-step pools on the route** make V3.4 visible and actionable.

This is the workspace the rest of V3.x has been designing toward. The pieces exist; they just need to be composed on one canvas.

End of mockup.

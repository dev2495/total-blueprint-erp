# Product Master — Model Refinement & UX Plan

> **Audience:** Codex implementation agent.
> **Scope:** Product Master model, create modal, detail workspace, services, mock data.
> **Out of scope:** Sales create page, Stock launcher consumer flow, packing/dispatch downstream. (Those will adapt automatically once the model is correct; we will pass over them in a separate plan after this lands.)
> **Mode:** Production-ready, type-safe, zero console errors. Mock data must mirror real backend shape so the dev preview keeps working without the Django API.

---

## 1. Why this exists

Today the **Product Master (PM)** create modal asks the user to pick a *kind* — Finished pouch, Roll/film, Packaging, POD, Bulk/generic, Other. This is correct in shape but wrong in three places:

1. **POD-kind and Packaging-kind PMs let the user invent free-text codes**, even though we already have `PodSkuVariant` and `PackagingMaterial` master-data tables. This creates a parallel registry that drifts from the real catalog.
2. **Bulk/generic** has no documented purpose, so it's used as a dumping ground or skipped entirely. Sales pickers also surface it incorrectly.
3. The detail workspace shows **the same tabs and sections for every kind**, including ones that don't apply (e.g. customer overlays on a Bulk WIP master).

This document defines the correct rules, the create-time UX, the detail-workspace UX, and the implementation order.

---

## 2. The mental model (the rule that resolves everything)

> **Master-data tables (`PodSkuVariant`, `PackagingMaterial`) = "what SKUs exist in our world."**
> **Product Master = "how we manufacture them — what axes vary, what route, what BOM."**
> A PM of kind=POD or kind=PACKAGING **does not invent new SKUs.** It tells the system: *"Here is the recipe and route for these existing catalog SKUs."*

Every other rule in this document follows from that one sentence.

---

## 3. PM kind taxonomy (final)

| Kind | Manufactures | Output materializes as | Sales picker shows? | Planner picker shows? | Catalog linkage required? |
|---|---|---|---|---|---|
| `POUCH` | Finished pouches | Variant in PM's variant matrix; sold to customer | **Yes** | Yes | No |
| `ROLL` | Sellable / intermediate film rolls | Variant in PM's variant matrix; sold *or* used upstream | **Yes** | Yes | No |
| `PACKAGING` | Printed inner pouches, branded gunny, custom sleeves | **Inventory of linked `PackagingMaterial` rows** | Yes (when sold as packaging item) | Yes | **Yes — link to `PackagingMaterial[]`** |
| `POD` | Print-on-demand variants | **Inventory of linked `PodSkuVariant` rows** | Yes (when ordered as POD) | Yes | **Yes — link to `PodSkuVariant[]`** |
| `BULK` | Upstream WIP master rolls / semi-finished laminate | Stock pool only; consumed by other PMs' BOMs | **No** | **Yes** | No |
| `OTHER` | One-offs that don't fit | Variant in PM's variant matrix | Yes (configurable) | Yes | No |

**Hard rules:**

- A PM with `kind=PACKAGING` must have at least one linked `PackagingMaterial` before it goes Active.
- A PM with `kind=POD` must have at least one linked `PodSkuVariant` before it goes Active.
- A PM with `kind=BULK` must NEVER appear in the sales master picker. Filter at fetch time, not just at render time.
- Linkage is **multi-select** (one PM can produce multiple catalog SKUs as variants).
- Linkage is the source of truth for that PM's **variants** — variants auto-materialize from the linked catalog rows. The `variant_axes` for these kinds collapse to a single axis: `pod_variant` or `packaging_code`.

---

## 4. Backend changes

### 4.1 `apps/recipes` (or wherever `ProductMaster` model lives)

Add the linkage fields to `ProductMaster`:

```python
# apps/recipes/models.py (illustrative — confirm app name)
class ProductMaster(models.Model):
    # … existing fields …

    # NEW: linkage to master-data catalog rows
    linked_pod_skus = models.ManyToManyField(
        "materials.PodSkuVariant",
        blank=True,
        related_name="manufacturing_masters",
        help_text="Required when product_kind=POD. Catalog SKUs this master manufactures.",
    )
    linked_packaging_materials = models.ManyToManyField(
        "materials.PackagingMaterial",
        blank=True,
        related_name="manufacturing_masters",
        help_text="Required when product_kind=PACKAGING. Catalog rows this master manufactures.",
    )

    def clean(self):
        super().clean()
        if self.product_kind == "POD" and self.active and not self.linked_pod_skus.exists():
            raise ValidationError("POD master must link at least one PodSkuVariant before activation.")
        if self.product_kind == "PACKAGING" and self.active and not self.linked_packaging_materials.exists():
            raise ValidationError("Packaging master must link at least one PackagingMaterial before activation.")
```

Migration: `0XXX_product_master_catalog_linkage.py` — additive, no data loss.

### 4.2 Serializer

`ProductMasterSerializer` exposes:

```python
linked_pod_skus = serializers.PrimaryKeyRelatedField(
    many=True, queryset=PodSkuVariant.objects.all(), required=False
)
linked_pod_skus_detail = PodSkuVariantSerializer(
    source="linked_pod_skus", many=True, read_only=True
)
linked_packaging_materials = serializers.PrimaryKeyRelatedField(
    many=True, queryset=PackagingMaterial.objects.all(), required=False
)
linked_packaging_materials_detail = PackagingMaterialSerializer(
    source="linked_packaging_materials", many=True, read_only=True
)
```

### 4.3 Variant materialization (server-side hook)

When `linked_pod_skus` or `linked_packaging_materials` is updated, **recompute** the PM's variants:

- For each linked catalog row, ensure a matching `ProductVariant` exists with `axis_values = { pod_variant: <code> }` (or `packaging_code`).
- Mark variants whose linked catalog row was removed as `active=False` (do not delete — they may have history).

Do this in a `post_save` signal on the M2M through table.

### 4.4 Sales picker filter

In whichever endpoint the sales create page calls (`/api/recipes/product-masters/?for=sales`), exclude `product_kind=BULK` by default. Add an explicit `?include_bulk=1` flag for admin tooling.

---

## 5. Frontend type changes

### 5.1 `frontend_v2/src/services/product-master.ts`

Extend `ProductMaster`:

```ts
export interface ProductMaster {
    // … existing fields …
    linked_pod_sku_ids?: string[];           // write-side
    linked_pod_skus?: PodSkuVariant[];       // read-side (detail expansion)
    linked_packaging_material_ids?: string[];
    linked_packaging_materials?: PackagingMaterial[];
}
```

Import the catalog types from `master-data.ts` so we don't redefine.

### 5.2 New helper

```ts
export function isCatalogLinkedKind(kind: ProductKind): boolean {
    return kind === "POD" || kind === "PACKAGING";
}

export function isSalesVisibleKind(kind: ProductKind): boolean {
    return kind !== "BULK";
}
```

### 5.3 List endpoint

`productMasterService.list()` already accepts `product_kind`. Add a convenience:

```ts
list: async (params?: { …; for_sales?: boolean }) => {
    // when for_sales is true, exclude BULK
    if (params?.for_sales) params.exclude_bulk = true;
    // pass through to /api/recipes/product-masters/
}
```

Mock fallback: filter the in-memory seed by kind too.

### 5.4 Mock seed updates

In the mock data block (lines ~200–400 of `product-master.ts`):

- Add `linked_pod_skus` to the existing PM-POD-ROLL seed — populate with 2-3 fake `PodSkuVariant` objects (POD-220, POD-260, POD-300).
- Add `linked_packaging_materials` to a new PM-PACKAGING-INNER seed — populate with 2 fake `PackagingMaterial` objects (INNER-POUCH-24, INNER-POUCH-12).
- Ensure the BULK seed (PM-BULK-LAMINATE) has `excluded_from_sales=true` set (or rely on kind filter).

---

## 6. UX — Create modal

The modal is currently a single-page form. Convert it into a **kind-aware progressive disclosure** flow without making it longer for the simple cases.

### 6.1 Layout (unchanged for POUCH / ROLL / BULK / OTHER)

For these four kinds the modal stays as-is:
- Kind picker (top)
- Master code + reporting group
- Master name
- Live route / template (optional)
- Description
- Active immediately toggle
- [Cancel] [Create & open workspace]

### 6.2 New step for POD and PACKAGING

When the user clicks `POD` or `Packaging` in the kind picker, **insert one new section** between *Master Name* and *Live route*:

```
┌─ LINKED CATALOG SKUS ─────────────────────────────────┐
│  Required — pick the catalog rows this master makes. │
│  Variants will auto-create one per selection.        │
│                                                       │
│  [🔍 Search POD variants…]                            │
│                                                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │ ☑ POD-220 · 220mm clear sleeve                   │ │
│  │ ☑ POD-260 · 260mm clear sleeve                   │ │
│  │ ☐ POD-300 · 300mm clear sleeve                   │ │
│  │ ☐ POD-340 · 340mm clear sleeve                   │ │
│  │ ☐ POD-380 · 380mm matte sleeve                   │ │
│  └──────────────────────────────────────────────────┘ │
│                                                       │
│  Selected: 2 SKUs · Variants will materialize on save │
└───────────────────────────────────────────────────────┘
```

**Component:** `<CatalogLinkPicker kind="POD" value={selectedIds} onChange={setSelectedIds} />`

**Behavior:**
- Lazy-loaded list from `masterDataService.getPodSkuVariants({ active: true })` or `getPackaging()`.
- Search filters by code or label.
- Multi-select with checkboxes; selected count badge above.
- Empty state: *"No POD SKUs in catalog yet. [Create one →]"* deep-links to master-data create page in a new tab.
- The list is scrollable inside `max-h-72 overflow-y-auto` (re-use the overflow pattern from earlier work).
- Validation: cannot click *Create & open workspace* with zero selections when kind is POD or PACKAGING — show inline error: *"Pick at least one catalog SKU."*

### 6.3 Default route hints per kind

In the *Live route / template* dropdown, pre-filter templates compatible with the kind:

| Kind | Default suggested templates |
|---|---|
| POUCH | `ROLL_TO_BULK`, `EXTRUSION_TO_POUCH` |
| ROLL | `BULK_TO_ROLL`, `SLITTING` |
| PACKAGING | `PACKAGING`, `INNER_POUCH_PRINT` |
| POD | `POD`, `POD_PRINT` |
| BULK | `EXTRUSION`, `LAMINATION_ONLY` |
| OTHER | (all) |

Surface as: dropdown shows compatible templates first under a *"Recommended for this kind"* group, then the rest under *"All templates"*. Don't hard-block — user can override.

### 6.4 BULK kind warning

When user picks `Bulk / generic`, show a small info banner above the route field:

```
ⓘ  Bulk masters are upstream WIP — they will not appear in the sales
   picker. The planner can still launch stock against them.
```

This sets correct expectations.

### 6.5 Modal visual polish (carry forward from earlier work)

The modal already uses the `Dialog` component which we styled in the previous iteration (rounded-2xl, backdrop-blur, ring). Keep that. Two specific polish tasks:

- The kind picker tile grid should use the same gradient-on-active styling as the size picker on the workspace (border-blue-400 + bg-gradient-to-br + ring-2 + shadow-blue-100 when active).
- The header gradient should darken slightly when scrolling — use `sticky top-0 backdrop-blur` pattern with z-10.

---

## 7. UX — Detail workspace (per-kind tab visibility)

Today every kind shows all 7 tabs (Spec & recipe, Variant matrix, Customer overlays, Artworks, Planner stock, Saved presets, Activity). For non-pouch kinds, several tabs are noise.

### 7.1 Tab visibility matrix

| Tab | POUCH | ROLL | PACKAGING | POD | BULK | OTHER |
|---|---|---|---|---|---|---|
| Spec & recipe | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Variant matrix | ✅ | ✅ | ✅ (read-only, derived from linkage) | ✅ (read-only, derived from linkage) | ✅ | ✅ |
| Customer overlays | ✅ | ✅ | ⚠️ optional | ⚠️ optional | ❌ | ⚠️ optional |
| Artworks | ✅ | ✅ if printable | ✅ if printable | ✅ | ❌ | ⚠️ optional |
| Planner stock | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Saved presets | ✅ | ✅ | ❌ | ❌ | ❌ | ⚠️ optional |
| Activity | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**❌ = hide. ⚠️ = show but with reduced default content.**

### 7.2 New "Linked Catalog" section (POD / Packaging only)

For POD and PACKAGING kinds, replace the *Variant matrix* tab's "Active axis dimensions" header with a new section card:

```
┌─ Linked POD SKUs · 3 catalog rows ─────────────────[Edit links]┐
│                                                                  │
│ ┌─ POD-220 ─────────┐ ┌─ POD-260 ─────────┐ ┌─ POD-300 ────────┐│
│ │ 220mm clear       │ │ 260mm clear       │ │ 300mm clear      ││
│ │ Active · 142 in stock │ Active · 89 in stock │ Active · 12 in stock │
│ │ Last produced 3d  │ │ Last produced 1w  │ │ Never produced   ││
│ └───────────────────┘ └───────────────────┘ └──────────────────┘│
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Variants below it become read-only — labeled "Auto-derived from linked catalog SKUs. Edit links to change." with an inline link to the edit modal.

### 7.3 Variant matrix changes for catalog-linked kinds

For PACKAGING / POD kinds, the variant matrix simplifies dramatically:
- One axis: `pod_variant` (or `packaging_code`)
- One row per linked catalog SKU
- Hide the "Active axis dimensions" gradient cards section (it would just show one card); instead show the *Linked Catalog* section described above.
- Allow add/remove via the *Edit links* button → opens the same `CatalogLinkPicker` from the create modal.

### 7.4 BULK kind detail workspace

For BULK kind:
- Hide *Customer overlays*, *Artworks*, *Saved presets* tabs entirely.
- The hero shows a prominent badge *"Internal WIP — not sold directly"*.
- Show an additional info card in the right rail:
    ```
    Used by:
    · PM-DRY-PET-LD (3 variants)
    · PM-CASHEW-MULTILAYER (1 variant)
    · PM-RAISIN-METALLIZED (2 variants)
    ```
  This requires a backend query: which downstream PMs have this PM as a BOM input.

### 7.5 Hero chip adjustments per kind

The hero shows KPI chips (KIND, AXES, VARIANTS, OVERLAYS, ARTWORKS, SIZES). Adjust per kind:

- **POD / PACKAGING:** replace AXES + VARIANTS with **LINKED SKUS** + **STOCK ON HAND** (sum across linked rows).
- **BULK:** replace OVERLAYS + ARTWORKS with **CONSUMERS** (count of downstream PMs) + **POOL SIZE** (current planner stock pool quantity).
- **POUCH / ROLL / OTHER:** unchanged.

### 7.6 Spec & recipe tab — kind-aware sections

Several sections in the Spec tab apply only to specific kinds. Conditionally render:

| Section | Hide when |
|---|---|
| Size geometry | kind ∈ { PACKAGING, POD, BULK } and no per-size variation needed |
| Layer template | kind ∈ { PACKAGING when single-layer, POD when single-layer } — show for multi-layer items |
| Print capabilities | kind = BULK or print_capable=false |
| Packaging + POD contract | kind = PACKAGING (the master IS packaging — would be circular) |

Replace hidden sections with a one-line note: *"N/A for this kind"* — don't leave gaps in the numbered section indices; renumber dynamically.

---

## 8. UX — General polish carry-forward

These polish items extend the work done previously and apply across all kinds:

### 8.1 Overflow scroll patterns

Already applied to most chip lists. Confirm coverage on:

- Linked-catalog SKU cards grid: `max-h-[28rem] overflow-y-auto`
- BULK consumers list: `max-h-60 overflow-y-auto`
- Variant table: `max-h-[36rem]` (already done)
- Edit-mode size editor: `max-h-[40rem]` (verify)

### 8.2 Empty states

Each kind needs a kind-appropriate empty state on first creation:

- POD: *"Linked catalog SKUs will appear here. Click Edit to add."* with a *Add catalog SKU* CTA.
- PACKAGING: same pattern.
- BULK: *"This master is upstream WIP. Configure size and layer to enable BOM linkage."*
- POUCH/ROLL/OTHER: existing copy.

### 8.3 Activity tab — kind-specific events

The Activity tab should show different event types per kind:
- POUCH/ROLL: variant created, axis edited, overlay added
- PACKAGING/POD: catalog SKU linked, catalog SKU unlinked, variant materialized
- BULK: consumer PM added (downstream PM started using this as BOM input), pool sized changed

Pull from the same activity stream but filter event types by kind for the default view; "Show all" toggle reveals everything.

### 8.4 Right-rail action buttons per kind

The right rail's "Use this master" card has two gradient action buttons. Adjust per kind:

| Kind | Primary action | Secondary action |
|---|---|---|
| POUCH / ROLL | Create sales order | Launch planner stock |
| PACKAGING / POD | Launch planner stock | Edit catalog links |
| BULK | Launch planner stock | View consumers |
| OTHER | Create sales order | Launch planner stock |

---

## 9. Service-layer detail (mock + real-API parity)

### 9.1 `productMasterService.create`

Accepts `linked_pod_sku_ids` and `linked_packaging_material_ids`. The mock implementation should:
1. Resolve those IDs against the in-memory master-data seed.
2. Auto-create a variant per linked row in the same response payload, so the detail page renders correctly without a second roundtrip.

### 9.2 `productMasterService.updateLinkedCatalog(id, payload)`

New method:
```ts
updateLinkedCatalog: async (id: string, payload: {
    linked_pod_sku_ids?: string[];
    linked_packaging_material_ids?: string[];
}): Promise<ProductMaster> => { ... }
```

Endpoint: `PATCH /api/recipes/product-masters/{id}/linked-catalog/`.

Mock fallback: mutate the in-memory record and recompute its variants array.

### 9.3 `productMasterService.listConsumers(id)`

For BULK kind detail rail:
```ts
listConsumers: async (id: string): Promise<ProductMaster[]> => { ... }
```

Endpoint: `GET /api/recipes/product-masters/{id}/consumers/` — backend returns all PMs whose layer template references this PM as a BOM input.

Mock: scan the seed for any PM whose `layer_template[].film_variant_code` matches a code declared by this PM.

---

## 10. Migration of existing data

### 10.1 Existing PM-POD-* records

For any existing POD-kind PM:
1. Look at its current variants.
2. For each variant whose code matches an existing `PodSkuVariant.code`, link it.
3. For variants with no match, log a warning and leave unlinked — admin must reconcile manually before next activation.

Provide a Django management command:
```
python manage.py reconcile_pm_catalog_links --kind POD --dry-run
python manage.py reconcile_pm_catalog_links --kind POD --apply
python manage.py reconcile_pm_catalog_links --kind PACKAGING --dry-run
```

Output: count linked, count unmatched, list of unmatched codes.

### 10.2 Existing PM-BULK or unkinded records

For PMs currently appearing in sales picker that should be BULK:
1. Provide a CSV import with `id, new_kind` mapping.
2. Backend admin command: `python manage.py reclassify_product_masters mapping.csv`.

This is a one-time tool; should not ship as a permanent feature.

---

## 11. Implementation order (pull request slicing)

Each PR should be independently reviewable and not break the dev preview.

### PR 1 — Backend model + migration (no UX yet)
- Add `linked_pod_skus`, `linked_packaging_materials` M2Ms.
- Migration, serializer changes, validator.
- Backend tests for clean()/save() rules.
- Sales picker `for_sales=true` filter that excludes BULK.

### PR 2 — Frontend service + types + mock seed
- Extend `ProductMaster` interface.
- Add `isCatalogLinkedKind`, `isSalesVisibleKind` helpers.
- Update mock seeds with linked catalog rows.
- Add `updateLinkedCatalog` and `listConsumers` methods (mock + real-API stubs).
- No UI changes yet.

### PR 3 — `<CatalogLinkPicker>` component
- Reusable component used both in create modal and in detail-edit flow.
- Search + checkbox list + scrollable + count badge.
- Hooks to `masterDataService.getPodSkuVariants` and `getPackaging`.
- Storybook entry / preview test.

### PR 4 — Create modal kind-aware flow
- Wire `CatalogLinkPicker` into the modal for POD / PACKAGING kinds.
- BULK info banner.
- Per-kind template recommendations.
- Validation (cannot create POD/Packaging without at least one link).

### PR 5 — Detail workspace per-kind tab visibility
- Tab visibility matrix from §7.1.
- Hero chip adjustments from §7.5.
- Spec tab kind-aware sections from §7.6.
- BULK kind hides Customer overlays / Artworks / Saved presets.

### PR 6 — Linked Catalog section + variant matrix simplification
- New "Linked POD SKUs" / "Linked Packaging Materials" section card.
- Variant matrix becomes read-only for POD/Packaging kinds.
- *Edit links* opens `CatalogLinkPicker` in a Dialog.
- BULK consumers right-rail card (depends on `listConsumers`).

### PR 7 — Migration tooling + data reconciliation
- `reconcile_pm_catalog_links` management command.
- `reclassify_product_masters` import command.
- Documentation for ops team.

### PR 8 — Polish + acceptance
- Activity tab event filtering per kind.
- Right rail action buttons per kind.
- Empty states per kind.
- Final QA sweep.

---

## 12. Acceptance criteria

A PR is **done** only when all the following pass:

### 12.1 Functional
- [ ] Creating a POD-kind PM without selecting any linked SKU shows an inline validation error and disables the create button.
- [ ] Creating a POD-kind PM with two linked SKUs results in a PM whose detail page shows exactly two variants, both auto-derived.
- [ ] Editing the linked catalog from the detail page (adding a third SKU) results in a third variant appearing within one render cycle.
- [ ] Removing a linked SKU marks its variant inactive (not deleted) and shows an *Inactive* badge.
- [ ] Sales create page's master picker does **not** list any BULK-kind PM.
- [ ] Stock launcher's master picker **does** list BULK-kind PMs.
- [ ] BULK-kind PM detail page shows no Customer overlays / Artworks / Saved presets tabs.
- [ ] BULK-kind PM detail right rail shows a "Used by" list with downstream PMs.
- [ ] PACKAGING/POD detail page shows the new "Linked Catalog" section card and a read-only variant matrix.

### 12.2 Visual
- [ ] Create modal uses the existing rounded-2xl Dialog with backdrop-blur.
- [ ] `CatalogLinkPicker` list scrolls inside `max-h-72` and does not bloat the modal.
- [ ] Kind picker tile uses gradient-on-active treatment matching the size picker pattern.
- [ ] Hero KPI chips render the correct labels per kind (no "AXES: 0" on a POD master).

### 12.3 Type safety + tests
- [ ] `npx tsc --noEmit` returns zero errors.
- [ ] All new components have at least one render test.
- [ ] Service methods have at least one unit test for the mock fallback path.
- [ ] Backend `clean()` validation has positive + negative tests.

### 12.4 No regressions
- [ ] `/master/products` list page renders unchanged for existing POUCH/ROLL records.
- [ ] Existing PM-DRY-PET-LD detail page renders identically to before this PR series (it's a POUCH kind, untouched by this work).
- [ ] Sales create page still loads at `/sales/orders/create` with no console errors.
- [ ] Stock launcher still loads at `/production/planner/stock-launcher` with no console errors.

---

## 13. Test scenarios (manual QA after PR 8)

### 13.1 Happy path — create a new POD master
1. Navigate to `/master/products`.
2. Click **+ New Product Master**.
3. Pick *POD* kind.
4. Confirm the *Linked Catalog SKUs* section appears.
5. Enter master code `PM-POD-NEW-TEST`.
6. Search for "POD" in the linked picker — confirm POD-220, POD-260, POD-300 appear.
7. Select POD-220 and POD-260.
8. Pick a route template (e.g. POD route).
9. Click **Create & open workspace**.
10. Confirm detail page loads with:
    - Hero chip *LINKED SKUS: 2*
    - "Linked POD SKUs" section showing two cards
    - Variant matrix tab showing exactly two variants
    - Customer overlays tab still visible (⚠️ optional setting)

### 13.2 Edge case — try to create POD with zero links
1. Same flow as above but skip step 7.
2. Click **Create & open workspace**.
3. Confirm inline error: *"Pick at least one catalog SKU."*
4. Confirm modal stays open and form state preserved.

### 13.3 BULK kind — verify sales hides it
1. Create a PM with kind=BULK named `PM-BULK-QA-TEST`.
2. Navigate to `/sales/orders/create`.
3. Open the master picker.
4. Confirm `PM-BULK-QA-TEST` does **not** appear.
5. Navigate to `/production/planner/stock-launcher`.
6. Open the master picker.
7. Confirm `PM-BULK-QA-TEST` **does** appear.

### 13.4 Edit-link flow — add SKU after creation
1. Open detail page of a POD master.
2. Click **Edit links** in the Linked Catalog section.
3. Add one more SKU.
4. Save.
5. Confirm a new variant appears in the variant matrix without page reload.
6. Confirm hero chip *LINKED SKUS* increments by 1.

### 13.5 Remove linked SKU
1. Same as above but un-check a SKU that has prior order history.
2. Save.
3. Confirm the variant is marked Inactive (rose-tinted card + Inactive badge), not deleted.
4. Confirm hero chip *LINKED SKUS* decrements.

### 13.6 BULK consumers display
1. Open a BULK master that's referenced by at least one downstream PM (e.g. PM-BULK-LAMINATE).
2. Confirm right rail shows *Used by* list.
3. Click one entry → navigates to that downstream PM's detail page.

---

## 14. Out-of-scope reminders

The following are **NOT** part of this plan. They will be addressed in follow-up plans:

- Sales create page redesign (multi-line cart, repeat-last-order, presets) — separate doc.
- Stock launcher consumer-side changes for BULK-PM consumption.
- Customer overlay schema changes (separate from master kind).
- Artwork master integration improvements.
- Packing yard / dispatch flow.
- Costing / MRP integration.

---

## 15. Open questions for product owner (before implementation starts)

1. **Catalog row creation from within the modal** — Should the *Empty state → Create one →* link in `CatalogLinkPicker` open a nested dialog or a new tab? (Default: new tab, simpler.)
2. **Variant code format for catalog-linked kinds** — should the variant inherit the catalog SKU code verbatim (`POD-220`) or prefix with PM code (`PM-POD-NEW-TEST-POD-220`)? (Default: verbatim catalog code; the PM linkage is the join.)
3. **BULK price visibility** — internal WIP usually has a transfer price, not a sales price. Should the costing tab show transfer price prominently? (Out of this scope; flagged for costing plan.)
4. **Multi-tenancy / plant scoping** — does linkage need to be plant-specific? (Assumed: no, links are global; plant-specific stock comes from inventory.)

---

## 16. Sign-off

Owner: Product Master + Recipes domain.
Implementation lead: Codex.
Review: human eng lead before each PR merge.
Estimated effort: 8 PRs × ~4–8 hours each = 1.5–2 weeks single-thread, 1 week with parallelism.

End of plan.

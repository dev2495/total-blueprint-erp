# Packaging and POD Product Master Link Report - 2026-05-17

## Scope

This report covers the fix for Product Master variant links into Packaging and POD catalog masters in the active Claude worktree:

`/Users/devarshthakkar/local_repos/erp total/.claude/worktrees/optimistic-borg-130fe2`

The reported failures were:

- Packaging variant link dialog showed unrelated catalog rows, so an inner pouch Product Master could try to link to sheet, gunny, or outer bag catalog rows.
- Manual link mutation failed in the UI with a backend 404/400 style action failure.
- Creating a new in-house packaging catalog item directly from `/master/packaging` failed because backend validation still required `production_template`.
- POD and Packaging needed to stay consistent with Product Master logic while still being consumable as catalog/stock items.

## Fixes Made

### Packaging catalog validation

In-house packaging catalog rows no longer require a direct `production_template`.

This is intentional: Product Master is now the production contract. The packaging catalog row can exist as the stock/consumption item, and once linked to a Product Master variant, the variant becomes the source of production sizing and BOM logic.

Backend validation now only allows in-house packaging for the Product-Master-backed packaging types:

- `INNER_POUCH`
- `SHEET`

Purchased rows can still exist without production templates. In-house-only rows for non-PM packing types are blocked, so `OUTER_BAG`, `GUNNY`, etc. do not accidentally become unsupported in-house production items.

### Manual variant link rules

The backend now validates the selected target before changing any existing link.

Rules:

- `product_kind=PACKAGING` can link only to `InventoryMaterial.category=PACKAGING`.
- Packaging subtype must match:
  - inner pouch Product Master -> only `packaging_kind=INNER_POUCH`
  - roll/sheet Product Master -> only `packaging_kind=SHEET`
- `product_kind=POD` can link only to `InventoryMaterial.category=POD`.
- Other Product Master kinds cannot use this catalog link endpoint.
- A wrong link attempt is rejected without unlinking the current valid catalog row.

The frontend link picker now applies the same packaging subtype filter, so the user should only see valid target rows in the modal. For POD, the picker uses the fixed `PodSkuVariant` catalog and passes the underlying POD material link to the backend.

### Manual catalog linking

Product Master variants do not create Packaging or POD catalog SKUs automatically.

Final rule:

- Catalog SKUs are fixed master rows.
- A Packaging or POD Product Master variant is only the production contract.
- An admin must manually link that variant to one existing fixed catalog SKU.
- Packaging links target `/master/packaging` rows.
- POD links target existing `PodSkuVariant` rows and store the linked POD material as the stock/consumption identity.
- No variant save creates `InventoryMaterial`, `PodSku`, or `PodSkuVariant`.

### In-house demand resolution

In-house packaging demand now first follows `InventoryMaterial.produced_by_product_variant` when the linked variant belongs to a Packaging Product Master.

That means a manually linked packaging stock item no longer needs its own direct production template. The Product Master variant is the contract.

## Current Flow

The flow is now:

1. Create a Packaging Product Master for the actual in-house packing family.
2. Set its packaging kind:
   - `INNER_POUCH` for pouch inner packing.
   - `SHEET` for roll wrap / sheet-style packaging.
3. Create variants from Product Master.
4. Create or choose the fixed catalog SKU in `/master/packaging`.
5. Manually link the Product Master variant to that fixed catalog SKU.
6. The UI and backend allow only same-category, same-subtype links.
7. Sales/packing consumption uses the catalog item.
8. In-house production demand resolves back to the linked Product Master variant for BOM and sizing.

For POD:

1. Create a POD Product Master.
2. Create variants from Product Master.
3. Create or choose the fixed POD SKU variant in `/master/pod`.
4. Manually link the Product Master variant to that existing POD SKU variant.
5. Sales can consume POD using the existing POD SKU catalog path.
6. Production logic remains Product-Master-backed through the manual link.

## Confidence and Design Assessment

I am confident this is the right current architecture for in-house Packaging and POD:

- Product Master owns production logic, dimensions, variants, and BOM consistency.
- Catalog rows remain the inventory/consumption surface.
- Manual links are guarded by backend validation, not just UI filtering.
- Wrong subtype links are blocked before state changes.
- POD is not treated as a generic packaging row; it stays in the fixed POD SKU catalog path while still being PM-linked for in-house production.

I would not call any ERP flow "100% perfect forever" yet because local data and older direct-template code paths can still contain legacy assumptions. The main remaining hardening I recommend is:

- Add an audit command/report for active in-house packaging/POD catalog rows that are not Product-Master-linked.
- Add a clear source/status field such as `PM_BACKED`, `PURCHASED`, and `LEGACY` for catalog rows.
- Continue moving any remaining direct packaging-template planner paths to the same Product Master contract helper used by in-house demand.

## Verification

Passed backend checks:

```text
/Users/devarshthakkar/local_repos/erp total/venv/bin/python manage.py test apps.materials.tests_packaging_master apps.materials.tests_product_master.ProductMasterApiTests --keepdb --verbosity=1
Result: OK, 34 tests

/Users/devarshthakkar/local_repos/erp total/venv/bin/python manage.py test apps.production.tests.test_in_house_demand_service --keepdb --verbosity=1
Result: OK, 13 tests

/Users/devarshthakkar/local_repos/erp total/venv/bin/python -m py_compile apps/materials/models.py apps/materials/serializers.py apps/materials/views.py apps/materials/services_product_variant.py apps/production/services/in_house_demand_service.py
Result: OK

/Users/devarshthakkar/local_repos/erp total/venv/bin/python manage.py check
Result: OK
```

Passed frontend checks:

```text
npm run typecheck
Result: OK

npm run build
Result: OK
Note: existing Next font warning in src/app/layout.tsx remains unrelated to this fix.
```

Passed local server verification:

```text
env BACKEND_PYTHON=/Users/devarshthakkar/local_repos/erp total/venv/bin/python bash ./start_all.sh start
Result: backend=200, frontend=200

env BACKEND_PYTHON=/Users/devarshthakkar/local_repos/erp total/venv/bin/python bash ./start_all.sh restart
Result: backend=200, frontend=200

env BACKEND_PYTHON=/Users/devarshthakkar/local_repos/erp total/venv/bin/python bash ./start_all.sh verify
Result: deep verification passed

curl http://127.0.0.1:8000/api/health/
Result: ok

curl -I http://127.0.0.1:3001/master/packaging
Result: HTTP 200

curl -I http://127.0.0.1:3001/master/products
Result: HTTP 200
```

Browser verification:

- Opened `http://127.0.0.1:3001/master/packaging`.
- Opened `http://127.0.0.1:3001/master/pod`.
- Opened Packaging and POD Product Master edit pages.
- Verified visible copy says fixed SKU + manual link only.
- Verified Packaging/POD master pages show `PM-BACKED` / `PM-LINKED`, `NEEDS PM LINK`, and `PRODUCT MASTER LINK`.
- Verified Product Master edit pages show 4 real production axes and do not show stale `packaging_ref` / `pod_ref` catalog axes.
- Verified no visible `auto-sync`, `auto-posted`, `auto-created`, or `Linked Production Template` wording remains on the Packaging/POD catalog pages or Packaging/POD Product Master edit pages.

## Local Data Note

During the local restart, pending materials migrations ran:

- `0028_drop_pm_packaging_lines`
- `0029_pm_packaging_kind_and_variant_link`
- `0030_soft_delete_legacy_inner_pouch`

Migration `0030` was changed to a no-op after the final manual-link decision. The earlier local run had soft-deleted 7 unlinked inner pouch rows; those rows were restored to `ACTIVE` locally because unlinked fixed SKUs are valid in the manual-link model.

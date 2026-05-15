# Product Master V3.3 — Backend Handoff

> **Status:** Frontend lives at `frontend_v2/`, fully refactored to V3.3 axis-level catalog linkage.
> Backend (Django) needs the matching changes below to flip the system from "graft-from-seed" to a real production round-trip.

---

## 1. Mental model

> **POD is a type of film** — extruded LD (or similar), printable, sits as a top layer.
> **Inner pack** is a manufactured pouch used in-house to bundle finished pouches (24/inner, 12/inner, …).
> Both already exist in master-data catalogs (`PodSkuVariant`, `PackagingMaterial`).
> **A pouch ProductMaster declares an axis** (e.g. `pod_variant`, `packaging_inner`) **whose allowed values are pulled from those catalogs**. Sales picks the value at order time. BOM consumes that exact catalog code. If stock pool is short for an item flagged in-house produced, **auto-demand fires a stock-launcher order**.
>
> No parallel registry. No requirement-rule indirection. One axis = one catalog dropdown = one BOM line.

---

## 2. Schema changes

### 2.1 `apps/recipes/models.py` — extend `VariantAxisDef`

Today `VariantAxisDef` is stored as JSON inside `ProductMaster.variant_axes`. Add the following fields (JSON-shape, not a separate table):

```python
# Already shipped (unchanged):
#   axis: str
#   type: str
#   required: bool
#   label: str

# NEW V3.3 fields:
master_data_source: Literal["pod_sku_variant", "packaging_material", "addon"] | None
master_data_filter: dict | None              # e.g. {"packaging_kind": "INNER_POUCH"}
qty_formula: str | None                      # e.g. "ceil(total_pouches / pcs_per_inner)"
qty_per_pcs: float | None                    # shortcut for "consume N units per parent piece"
default_value: str | None                    # default catalog code, e.g. "INNER-POUCH-24"
auto_demand_in_house: bool                   # default False; True triggers in-house stock launcher
```

Since these are JSON, no migration needed — but **`ProductMasterSerializer` must validate** the shape when accepting incoming axes.

### 2.2 `ProductMasterSerializer.validate_variant_axes`

Required validations:

- `master_data_source` (when present) must be one of the three literal values.
- If `master_data_source` is set, `axis` should not collide with system axes (`size`, `layer_thicknesses`, etc.). Convention: catalog-backed axes use names like `pod_variant`, `packaging_inner`, `packaging_outer`.
- `qty_formula` must use only allowed tokens (`total_pouches`, `total_pcs`, `total_kg`, `pcs_per_inner`, `fixed_qty`) and operators (`+`, `-`, `*`, `/`, `ceil()`, `floor()`, `round()`, parentheses, integers, decimals). No identifiers. No function calls other than the three.
- `default_value` (if set) must exist in the catalog filtered by `master_data_filter`.

Add a small evaluator in `apps/recipes/qty_formula.py`:

```python
import math, ast, operator

ALLOWED_BINOPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv}
ALLOWED_FUNCS = {"ceil": math.ceil, "floor": math.floor, "round": round}
ALLOWED_TOKENS = {"total_pouches", "total_pcs", "total_kg", "pcs_per_inner", "fixed_qty"}

def evaluate_qty_formula(formula: str, context: dict) -> float:
    """Safe evaluator. Raises ValueError on disallowed nodes."""
    tree = ast.parse(formula, mode="eval")

    def _eval(node):
        if isinstance(node, ast.Expression): return _eval(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)): return node.value
        if isinstance(node, ast.Name):
            if node.id not in ALLOWED_TOKENS: raise ValueError(f"Disallowed name: {node.id}")
            return float(context.get(node.id, 0))
        if isinstance(node, ast.BinOp) and type(node.op) in ALLOWED_BINOPS:
            return ALLOWED_BINOPS[type(node.op)](_eval(node.left), _eval(node.right))
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ALLOWED_FUNCS:
            return ALLOWED_FUNCS[node.func.id](*[_eval(a) for a in node.args])
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -_eval(node.operand)
        raise ValueError(f"Disallowed expression: {ast.dump(node)}")

    return float(_eval(tree))
```

Round to integer when `auto_demand_in_house=True` (you can't produce a fractional inner pouch).

### 2.3 `apps/materials/models.py` — flag in-house production

Add (or confirm) a boolean on each catalog row indicating whether we manufacture it in-house:

- `PodSkuVariant.pod_is_inhouse_produced: bool` — already exists per `frontend_v2/src/services/master-data.ts`.
- `PackagingMaterial.packaging_supply_mode: Literal["PURCHASED", "IN_HOUSE", "BOTH"]` — already exists.

The auto-demand resolver only fires for rows with `pod_is_inhouse_produced=True` or `packaging_supply_mode in ("IN_HOUSE", "BOTH")`.

---

## 3. Sales submit — BOM resolver

### 3.1 Endpoint

`POST /api/sales/orders/` (existing). The submit handler must, for each line:

1. Look up the line's pouch `ProductMaster.variant_axes`.
2. For each axis with `master_data_source`:
    a. Pick the chosen value: `axis_values[axis_name]`, falling back to `default_value`, falling back to overlay default.
    b. Resolve the catalog row: query the relevant master-data table by `code`, applying `master_data_filter`.
    c. Compute consumed qty via `evaluate_qty_formula` with context `{total_pouches: pouches_from_qty(line), pcs_per_inner: overlay.pcs_per_inner or default}`.
    d. Add a BOM line to the order: `(catalog_source, catalog_code, qty)`.

### 3.2 Stock allocation

For each BOM line:

- Query `StockPool` for `code=catalog_code, available >= qty`.
- If found → allocate.
- If not found AND `auto_demand_in_house=True` AND the catalog row is marked in-house → call `apps/production/stock_launcher.create()` with:
  ```python
  {
    "product_master": <pm-pod-ldnat or pm-inner-pack-ld id>,  # the manufacturing recipe
    "axis_values": {<resolved tuple matching the catalog row>},
    "qty_required": qty,
    "trigger_source": f"sales_order:{order.id}:{line.id}:{axis_name}",
    "lock_to_customer": order.customer_id if axis-policy says so else None,
  }
  ```
- If not found AND not in-house → block submit with explicit error: *"INNER-POUCH-24 stock unavailable, please source first."*

### 3.3 Order ↔ stock-launcher linkage

Persist the auto-demand link so the planner UI can show "this stock-launcher order was triggered by SO #1234 line 2 / pod_variant axis." Use `StockOrder.trigger_source` text field (e.g. `sales:SO-1234:line-2:pod_variant`).

---

## 4. New frontend-facing endpoints (small additions)

### 4.1 `GET /api/master/products/<id>/catalog-bom-preview/?axis_values=...&total_pouches=...`

Pure preview — no side effects. Server-side mirror of frontend `productMasterService.resolveCatalogBom` but using real overlay data and current stock check. Used to show the green "Catalog BOM preview" panel on the sales page with REAL stock-availability flags.

Response:
```json
{
  "lines": [
    {
      "axis": "pod_variant",
      "catalog_source": "pod_sku_variant",
      "catalog_code": "POD-220-30U-GP",
      "required_qty": 100000,
      "available_in_stock": 87500,
      "shortfall": 12500,
      "auto_demand_in_house": true,
      "would_create_demand": true
    }
  ]
}
```

### 4.2 `GET /api/master/products/<id>/consumers/`

For BULK-kind detail right rail. Returns `[{id, code, name}]` for any `ProductMaster` whose `layer_template[].film_variant_code` references a code produced by this master.

(Already mock-implemented frontend-side; needs real impl.)

---

## 5. Mock-fallback removal sequence

Once the backend changes ship, remove these temporary frontend grafts:

| Frontend file | Line | What to remove |
|---|---|---|
| `services/product-master.ts` | `get()` mock-fallback graft of `master_data_source` axes | The `seedHasCatalogBacking && !liveHasCatalogBacking` block |
| `services/product-master.ts` | `resolveCatalogBom()` | Keep — call site replaced with real preview endpoint above |

---

## 6. Test scenarios for backend

1. **Create** a pouch master with axes including `{axis: "pod_variant", master_data_source: "pod_sku_variant", qty_per_pcs: 1, auto_demand_in_house: true}`. Confirm `GET` round-trips the field.
2. **Validate** a payload with `qty_formula: "exec(__import__('os').system('rm -rf /'))"`. Confirm rejection by formula validator.
3. **Sales submit** with `axis_values.pod_variant: "POD-220-30U-GP"`, `total_pouches: 1000`. Confirm one BOM line created with `qty=1000` and one stock-launcher order created if pool short.
4. **Sales submit** with `pod_variant` left empty. Confirm: optional → no BOM line; required → 400 error "POD variant required."
5. **Sales submit** when catalog row is `pod_is_inhouse_produced=False` and stock is short. Confirm: hard error, no auto-demand.
6. **BULK consumers endpoint**: create PM-DRY-PET-LD whose layer references PM-BULK-LAMINATE's code. GET `/consumers/` on the bulk PM should list PM-DRY-PET-LD.

---

## 7. Effort estimate

| Item | Hours |
|---|---|
| §2 Schema field validators + formula evaluator | 4 |
| §3 Sales submit BOM resolver + auto-demand | 8 |
| §4.1 catalog-bom-preview endpoint | 3 |
| §4.2 consumers endpoint | 2 |
| Tests (positive, negative, security) | 5 |
| QA + production data smoke | 4 |
| **Total** | **~26 hours / 3 working days** |

---

## 8. Frontend is ready now

The frontend (this worktree) is fully wired against this contract. Today it works against:
- Real catalogs (PodSkuVariant + PackagingMaterial endpoints — already 200).
- Mock-grafted axis declarations on `ProductMaster.variant_axes` until backend ships them.
- Frontend-computed `resolveCatalogBom()` for the live BOM preview.

When backend ships §2–§4, **flip the graft off** (one `if` block in `services/product-master.ts`) and the system goes live with full round-trips.

End of handoff.

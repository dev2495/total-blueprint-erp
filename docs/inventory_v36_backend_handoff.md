# Inventory V3.6 — Backend Handoff (Codex)

> **Audience:** backend engineer (Codex) wiring the V3.6 inventory frontend to live Django/DRF endpoints.
> **Frontend status:** complete and merged at `frontend_v2/src/components/inventory-v36/*` and routes `/inventory`, `/inventory/period`, `/inventory/grn-v36`, `/inventory/count`.
> **Backend status:** existing services (`inventoryService`) already cover the bulk of read/write paths via `getRollStock`, `getBulkStock`, `getPackagingStock`, `createBulkGRN`, `createRollGRN`, `createPackagingGRN`, `getAuditBatches`, `getAuditPeriods`. This document lists the **gaps** and **enhancements** required for the new V3.6 surfaces.

---

## 1. Locked-in product decisions

These were confirmed with the owner and drive the contract:

| Topic                       | Decision                                                                |
| --------------------------- | ----------------------------------------------------------------------- |
| Variance threshold          | **2 %** for both ROLL and BULK/PACKAGING. Anything above flags & blocks |
| Owner sign-off              | Required only on **year-end close**, not monthly cycle                  |
| Period close                | Allowed **anytime**, not bounded to month-end                           |
| Multi-plant rollout         | If one plant fails close, **pause + reset** (no partial year close)     |
| Audit batches               | Support **full** count and **chunked** count in same period             |
| Mobile UI                   | Separate `/inventory/count` route, offline-first                        |
| Sales reservation visibility | Show reserved-vs-free everywhere stock surfaces                         |

---

## 2. New / updated endpoints

### 2.1 Unified Smart GRN (replaces 3 endpoints)

Frontend: `/inventory/grn-v36` (component `grn-smart-v36.tsx`).
The form picks `klass` (BULK | ROLL | PACKAGING) up-front and the right rail validates and submits.

**Today** the service calls `inventoryService.createBulkGRN`, `createRollGRN`, `createPackagingGRN` in three branches. **Required:** keep these three working **and** add a single unified endpoint to simplify future GRN flows.

```
POST /api/inventory/grn/create
```

Request:
```jsonc
{
  "klass": "ROLL" | "BULK" | "PACKAGING",
  "vendor_id": "uuid",
  "vendor_invoice_no": "INV/24-25/00123",
  "vendor_invoice_date": "2026-05-09",
  "plant_id": "uuid",
  "store_location_id": "uuid",
  "reference_po_id": "uuid?",
  "transport": {
    "lr_no": "string?",
    "lr_date": "YYYY-MM-DD?",
    "vehicle_no": "string?",
    "transporter_name": "string?"
  },
  "remarks": "string?",
  "lines": [
    // ROLL lines (klass=ROLL)
    {
      "product_id": "uuid",
      "variant_id": "uuid",
      "roll_label": "TPP/RM/2026/0001",
      "vendor_roll_label": "string?",
      "net_weight_kg": 245.5,
      "gross_weight_kg": 247.0,
      "tare_weight_kg": 1.5,
      "length_m": 1850,
      "width_mm": 1040,
      "thickness_um": 50,
      "core_size_inch": 3,
      "treatment_side": "INSIDE | OUTSIDE | BOTH | NONE",
      "print_direction": "FACE | REVERSE | NONE",
      "rate_per_kg": 145.50,
      "uom": "KG"
    },
    // BULK lines (klass=BULK)
    {
      "product_id": "uuid",
      "variant_id": "uuid?",
      "qty": 1500.0,
      "uom": "KG | L",
      "lot_no": "string?",
      "rate_per_uom": 92.30,
      "expiry_date": "YYYY-MM-DD?"
    },
    // PACKAGING lines (klass=PACKAGING)
    {
      "product_id": "uuid",
      "variant_id": "uuid?",
      "packaging_kind": "CARTON | POLYBAG | STRAP | TAPE | OTHER",
      "qty": 5000,
      "uom": "PCS",
      "pcs_per_pack": 25,
      "color_variant": "string?",
      "rate_per_uom": 4.20
    }
  ]
}
```

Response (201):
```jsonc
{
  "id": "uuid",
  "grn_no": "GRN/2026/05/00045",
  "status": "POSTED",
  "klass": "ROLL",
  "totals": { "qty": 245.5, "value": 35720.25 },
  "stock_movements": [{ "id": "uuid", "ref": "..." }]
}
```

Validation rules:
- ROLL: `gross = net + tare ± 0.05 kg`; `roll_label` unique per plant; `length_m * width_mm` consistent with `net_weight_kg / (thickness_um × density)` within 5 %
- BULK: `qty > 0`, `uom` from product master
- PACKAGING: `qty > 0`, `pcs_per_pack ≥ 1`
- Period not locked (see §2.5)
- Vendor active and approved for `product_id` (warning, not blocker)

### 2.2 Stock snapshot (unified)

Frontend: `/inventory` calls `getRollStock`, `getBulkStock`, `getPackagingStock` separately. **Required:** add a single snapshot endpoint that returns all three classes plus reservation summary in one trip — saves 3 round-trips on home load.

```
GET /api/inventory/snapshot?plant_id=&as_of=
```

Response:
```jsonc
{
  "as_of": "2026-05-09T10:30:00Z",
  "plant_id": "uuid",
  "kpi": {
    "total_value_inr": 12_580_000,
    "total_kg": 184_200,
    "rolls_count": 312,
    "bulk_lots": 48,
    "packaging_skus": 27,
    "reservation_kg": 18_500,
    "free_kg": 165_700,
    "reservation_pct": 10.04,
    "ageing_buckets": { "0-30": 72, "31-60": 18, "61-90": 7, "90+": 3 } // % share
  },
  "rolls": [
    {
      "id": "uuid", "label": "...", "product_name": "...", "variant_code": "...",
      "thickness_um": 50, "width_mm": 1040, "net_weight_kg": 245.5,
      "location_code": "WH-A", "reserved_for_so_id": "uuid?", "age_days": 12
    }
  ],
  "bulk": [
    { "id": "uuid", "product_name": "...", "lot_no": "...", "qty": 800, "uom": "KG",
      "reserved_qty": 200, "free_qty": 600, "location_code": "WH-A", "age_days": 5 }
  ],
  "packaging": [
    { "id": "uuid", "product_name": "...", "qty": 4500, "uom": "PCS",
      "reserved_qty": 0, "free_qty": 4500, "location_code": "PACKING" }
  ]
}
```

### 2.3 Roll matrix pivot

The new home renders a **variant × thickness** heatmap. Backend can either:
- (a) compute server-side via `GET /api/inventory/snapshot/roll-matrix?plant_id=` returning `{ rows: [{ variant_id, variant_code, cells: [{ thickness_um, kg, count }] }] }`, OR
- (b) leave the pivot to the frontend (we already do this in `buildRollMatrix()`).

**Recommendation:** ship (a) once row count > 200 to avoid client-side pivot cost; for now (b) is fine.

### 2.4 Anomalies / aging feed

Frontend: KPI tile + "anomalies" section on `/inventory` need a single endpoint listing items requiring attention.

```
GET /api/inventory/anomalies?plant_id=&kind=
```

`kind` filters: `AGEING | NEGATIVE | OVER_RESERVED | DUPLICATE_LABEL | UOM_MISMATCH | VARIANCE_PENDING`

Response:
```jsonc
{
  "items": [
    {
      "kind": "AGEING",
      "severity": "warn | block",
      "ref_type": "ROLL | BULK | PACKAGING",
      "ref_id": "uuid",
      "label": "Roll TPP/RM/2025/01234",
      "message": "Aged 187 days, exceeds 90-day target",
      "suggested_action": "Move to clearance bin or write-off"
    }
  ]
}
```

### 2.5 Period management

Frontend: `/inventory/period` (component `period-workspace-v36.tsx`).

Already implemented (verify shapes):
- `GET /api/inventory/audit/periods` → list of fiscal periods with `id, label, status (OPEN|CLOSING|CLOSED|LOCKED), opened_at, closed_at`
- `GET /api/inventory/audit/batches?period_id=` → list of audit batches

**Required new:**

```
POST /api/inventory/audit/periods/:id/open
POST /api/inventory/audit/periods/:id/close          # checks no open batches, no >2% variance flagged
POST /api/inventory/audit/periods/:id/year-end-close # owner-only, requires owner_signoff_token
```

Year-end close payload:
```jsonc
{
  "owner_signoff_token": "string",   // 2FA / signed token
  "carry_forward_strategy": "AUTO | MANUAL_REVIEW",
  "ack_pause_on_failure": true       // multi-plant rollout: pause if any plant fails
}
```

Response includes per-plant status:
```jsonc
{
  "period_id": "uuid",
  "status": "PARTIAL | CLOSED | PAUSED",
  "plants": [
    { "plant_id": "uuid", "name": "Plant A", "status": "CLOSED", "carry_fwd_value_inr": 12_580_000 },
    { "plant_id": "uuid", "name": "Plant B", "status": "FAILED", "reason": "5 batches with variance >2%" }
  ]
}
```

### 2.6 Audit batch lifecycle

Already implemented: `getAuditBatches()`. **Required new endpoints:**

```
POST /api/inventory/audit/batches                    # create batch
GET  /api/inventory/audit/batches/:id                # details + lines
POST /api/inventory/audit/batches/:id/start          # mark in-progress
POST /api/inventory/audit/batches/:id/submit-line    # one count line at a time
POST /api/inventory/audit/batches/:id/finalize       # compute variance, lock
POST /api/inventory/audit/batches/:id/approve        # supervisor approval (when variance >2%)
```

Create batch payload:
```jsonc
{
  "period_id": "uuid",
  "scope": "FULL | CHUNKED",
  "plant_id": "uuid",
  "locations": ["WH-A", "WCM-PRT-1"],   // CHUNKED only
  "klass_filter": ["ROLL", "BULK", "PACKAGING"],
  "assigned_to_user_id": "uuid",
  "deadline": "YYYY-MM-DD"
}
```

Submit-line payload (one event per scan/count):
```jsonc
{
  "ref_type": "ROLL | BULK | PACKAGING",
  "ref_id": "uuid",
  "system_qty": 245.5,
  "counted_qty": 244.8,
  "uom": "KG",
  "location_code": "WH-A",
  "reason_code": "SPILLAGE | SHRINKAGE | MISCOUNT | RECOUNT | OTHER",
  "reason_note": "string?",
  "device_id": "string",
  "counted_at": "ISO timestamp",
  "offline_uuid": "client-generated-uuid"   // for idempotency on offline sync
}
```

Variance computation (server-side):
- `variance_pct = (counted_qty - system_qty) / system_qty * 100`
- If `|variance_pct| > 2` → `flagged = true`, blocks period close until approved

### 2.7 Mobile count specifics

Frontend: `/inventory/count` (component `mobile-count-v36.tsx`). Designed offline-first.

```
GET  /api/inventory/audit/batches/:id/locations      # list of locations + counts of items pending
GET  /api/inventory/audit/batches/:id/items?location=&cursor=
POST /api/inventory/audit/batches/:id/sync           # bulk submit when back online
```

Bulk sync payload:
```jsonc
{
  "events": [
    { "offline_uuid": "...", "ref_id": "...", "counted_qty": 244.8, ... },
    ...
  ]
}
```

Returns per-event status so UI can clear from local queue:
```jsonc
{
  "results": [
    { "offline_uuid": "...", "status": "OK", "server_id": "uuid" },
    { "offline_uuid": "...", "status": "DUPLICATE", "server_id": "uuid" },
    { "offline_uuid": "...", "status": "REJECTED", "reason": "Period closed" }
  ]
}
```

### 2.8 Day-0 / opening stock import

Frontend: Day-0 wizard on `/inventory/period` offers three modes (CSV, manual, mobile).

```
POST /api/inventory/opening-stock/csv         # multipart, CSV upload, dry-run + commit phases
POST /api/inventory/opening-stock/manual      # JSON, individual lines
POST /api/inventory/opening-stock/from-count  # promote a finalized audit batch into opening balance
```

CSV columns (validated):
```
plant_code, location_code, klass, product_code, variant_code,
qty, uom, weight_kg, length_m, width_mm, thickness_um, lot_no, label
```

Dry-run response:
```jsonc
{
  "rows_total": 1245,
  "rows_valid": 1230,
  "rows_invalid": 15,
  "errors": [{ "row": 42, "field": "thickness_um", "message": "Required for ROLL klass" }],
  "summary_by_klass": { "ROLL": 800, "BULK": 380, "PACKAGING": 50 }
}
```

Commit response: `{ batch_id, rows_committed, opening_value_inr }`.

### 2.9 Reservation visibility

Sales SO reservations must be exposed in stock APIs. Required:
- Snapshot endpoint already includes `reserved_for_so_id` per roll, `reserved_qty` for bulk/packaging
- New: `GET /api/inventory/reservations?ref_id=&ref_type=` → list of SO holds for a stock item

```jsonc
{
  "items": [
    { "so_id": "uuid", "so_no": "SO/2026/00123", "customer_name": "...",
      "qty": 200, "uom": "KG", "reserved_at": "ISO", "promise_date": "YYYY-MM-DD" }
  ]
}
```

---

## 3. Data model touch-ups

### 3.1 New tables

```sql
audit_period (
  id uuid PK, plant_id uuid FK, label text, status text,
  opened_at timestamp, closed_at timestamp, year_end boolean,
  owner_signoff_user_id uuid, owner_signoff_at timestamp
)

audit_batch (
  id uuid PK, period_id uuid FK, scope text, klass_filter text[],
  plant_id uuid FK, location_codes text[], assigned_to_user_id uuid,
  deadline date, status text, started_at timestamp, finalized_at timestamp,
  variance_pct_max numeric, flagged boolean, approved_by_user_id uuid
)

audit_count_event (
  id uuid PK, batch_id uuid FK, ref_type text, ref_id uuid,
  system_qty numeric, counted_qty numeric, uom text, variance_pct numeric,
  reason_code text, reason_note text, location_code text,
  counted_by_user_id uuid, device_id text, counted_at timestamp,
  offline_uuid uuid UNIQUE   -- idempotency
)

opening_stock_batch (
  id uuid PK, plant_id uuid, mode text, file_url text,
  rows_total int, rows_committed int, opening_value_inr numeric,
  created_by_user_id uuid, created_at timestamp
)
```

### 3.2 Existing tables — additions

- `stock_movement` — add `audit_batch_id uuid?` so writeback movements created at finalize trace back
- `roll`, `bulk_lot`, `packaging_lot` — ensure `reserved_for_so_id uuid?` and `reserved_qty numeric default 0` are present and indexed
- `period_lock` — central table or just `audit_period.status` enforced at write time

### 3.3 Period enforcement

All inventory writes must check the active period state for the targeted plant:

```python
def assert_period_writable(plant_id, txn_date):
    period = AuditPeriod.objects.filter(
        plant_id=plant_id,
        opened_at__lte=txn_date,
        status__in=["OPEN", "CLOSING"]
    ).first()
    if not period:
        raise PeriodLocked("No open period for this plant on this date")
    if period.status == "CLOSING" and not is_audit_writer():
        raise PeriodLocked("Period closing — only audit batches can write")
```

Apply to: GRN, transfers, issue/return, scrap, adjustments.

---

## 4. Endpoint summary table

| Method | Path                                              | Status        | Notes                              |
| ------ | ------------------------------------------------- | ------------- | ---------------------------------- |
| POST   | `/api/inventory/grn/create`                       | **NEW**       | Unified GRN replacing 3 endpoints  |
| GET    | `/api/inventory/snapshot`                         | **NEW**       | Single-call home page payload      |
| GET    | `/api/inventory/snapshot/roll-matrix`             | optional      | Server pivot when rolls > 200      |
| GET    | `/api/inventory/anomalies`                        | **NEW**       | Aging / negative / duplicate feed  |
| GET    | `/api/inventory/audit/periods`                    | exists        | Verify shape                       |
| POST   | `/api/inventory/audit/periods/:id/open`           | **NEW**       |                                    |
| POST   | `/api/inventory/audit/periods/:id/close`          | **NEW**       | 2 % variance gate                  |
| POST   | `/api/inventory/audit/periods/:id/year-end-close` | **NEW**       | Owner sign-off + multi-plant pause |
| GET    | `/api/inventory/audit/batches`                    | exists        |                                    |
| POST   | `/api/inventory/audit/batches`                    | **NEW**       | Full or chunked                    |
| POST   | `/api/inventory/audit/batches/:id/start`          | **NEW**       |                                    |
| POST   | `/api/inventory/audit/batches/:id/submit-line`    | **NEW**       | Idempotent via `offline_uuid`      |
| POST   | `/api/inventory/audit/batches/:id/sync`           | **NEW**       | Bulk offline sync                  |
| POST   | `/api/inventory/audit/batches/:id/finalize`       | **NEW**       |                                    |
| POST   | `/api/inventory/audit/batches/:id/approve`        | **NEW**       | Supervisor approval                |
| GET    | `/api/inventory/audit/batches/:id/locations`      | **NEW**       | Mobile UI                          |
| GET    | `/api/inventory/audit/batches/:id/items`          | **NEW**       | Mobile UI                          |
| POST   | `/api/inventory/opening-stock/csv`                | **NEW**       | Dry-run + commit                   |
| POST   | `/api/inventory/opening-stock/manual`             | **NEW**       |                                    |
| POST   | `/api/inventory/opening-stock/from-count`         | **NEW**       |                                    |
| GET    | `/api/inventory/reservations`                     | **NEW**       | Sales SO holds                     |
| GET    | `/api/inventory/snapshot/trend`                   | **NEW**       | 30-day in/out/net for sparkline    |
| GET    | `/api/inventory/snapshot/rolls`                   | **NEW**       | Cursor-paginated roll drill-down   |
| GET    | `/api/inventory/inter-plant/flows`                | **NEW**       | from→to aggregate for flow bar     |
| GET    | `/api/factory/plants?include_capabilities=true`   | enhance       | Plant network metadata             |
| GET    | `/api/inventory/saved-views`                      | **NEW**       | Per-workspace saved view list      |
| POST   | `/api/inventory/saved-views`                      | **NEW**       | Create saved view                  |
| PATCH  | `/api/inventory/saved-views/:id`                  | **NEW**       | Edit / pin saved view              |
| DELETE | `/api/inventory/saved-views/:id`                  | **NEW**       | Delete saved view                  |
| GET    | `/api/inventory/rolls`                            | **NEW**       | Cursor-paginated rolls + facets    |
| GET    | `/api/inventory/bulk`                             | enhance       | Cursor-paginated bulk + facets     |
| GET    | `/api/inventory/packaging`                        | enhance       | Cursor-paginated packaging         |
| GET    | `/api/inventory/addons`                           | **NEW**       | Inks/adhesives/solvents view       |
| GET    | `/api/inventory/coverage`                         | **NEW**       | Reorder &amp; coverage matrix      |
| GET    | `/api/inventory/<class>/export`                   | **NEW**       | CSV/XLSX export per workspace      |
| GET    | `/api/inventory/grn/history/`                     | exists        | Verify filter params · CSV format  |
| POST   | `/api/inventory/grn/history/:source/:id/correct/` | exists        | Reject when period CLOSED          |
| POST   | `/api/inventory/audit/periods/start/`             | exists        | Body: `{ financial_year }`         |
| GET    | `/api/inventory/<class>/pulse`                    | **NEW**       | Single-call analytics aggregates   |

---

## 5. Migration / phase plan (suggested)

1. **Phase A — read-only support (low risk):** ship `/snapshot`, `/snapshot/roll-matrix`, `/anomalies`, `/reservations`. Frontend already works without these (uses 3 separate calls); switch the home page once available.
2. **Phase B — period & audit lifecycle:** ship period open/close + batch CRUD + submit-line. Frontend `/inventory/period` will progressively light up.
3. **Phase C — mobile sync:** ship `/sync` bulk endpoint for offline-first counter app.
4. **Phase D — unified GRN:** ship `/grn/create`. Frontend can keep the 3-branch fallback until verified.
5. **Phase E — opening stock import:** finalize CSV schema with the user, then ship.
6. **Phase F — year-end close:** owner sign-off + multi-plant orchestration. Last because it's only used once a year.

---

## 6. Test fixtures the frontend already exercises

The V3.6 components were built against existing service shapes. Mock responses live in:
- `frontend_v2/src/services/inventory.ts` (look for `getRollStock`, `getBulkStock`, `getPackagingStock` shapes)
- `frontend_v2/src/components/inventory-v36/*-v36.tsx` (each section parses the shape)

When wiring real endpoints, **match the existing service shapes** so no frontend changes are required. The new endpoints listed in §2 can return either the same shapes (preferred) or supersets.

---

## 7. Things explicitly out of scope

- AI variance prediction (deferred to V3.7)
- Stock valuation method changes (FIFO/MA stays as configured per product)
- Inter-plant stock transfer redesign (separate doc `interplant_dc.md`)
- Costing center pulls (separate doc `client-deployment-and-costing.md`)

---

## 7B. Workspace enhancements — extra endpoints

The home, traceability and inter-plant V3.6 workspaces shipped with richer drill-down and analytics surfaces. The frontend currently fakes some series until these are live; please prioritise:

### 7B.1 Snapshot trend (30-day series)

Frontend: `inventory-home-v36.tsx` "30-day pulse" sparkline.

```
GET /api/inventory/snapshot/trend?plant_id=&days=30
```

Response:
```jsonc
{
  "buckets": [
    { "date": "2026-04-10", "in_kg": 1240, "out_kg": 980, "net_kg": 260 },
    ...
  ],
  "totals": { "in_kg": 38_000, "out_kg": 31_500, "net_kg": 6_500 }
}
```

### 7B.2 Reservations expansion

Frontend: `BulkDrawer` and `PackagingDrawer` already call `inventoryService.getInventoryReservations({ ref_id, ref_type })`. Confirm the existing `/api/inventory/reservations/` returns rows with: `so_no, customer_name, qty, uom, reserved_at, promise_date`.

### 7B.3 Roll genealogy enrichment

Frontend: `traceability-v36.tsx`. The current `/api/inventory/roll-trace/` payload is sufficient. Two nice-to-haves:
- `genealogy.weight_yield_pct` precomputed server-side
- `genealogy.first_grn` block — `{ grn_no, grn_date, vendor_name, original_weight_kg }` — to render an "origin GRN" pill at the head of the ancestor chain

### 7B.4 Inter-plant flow aggregate

Frontend: `inter-plant-v36.tsx` "Network flow" bar chart computes `from→to` aggregates client-side. For >200 active DCs, please add:

```
GET /api/inventory/inter-plant/flows?status=IN_TRANSIT
```

Response:
```jsonc
{
  "flows": [
    {
      "from_plant_id": "uuid", "from_plant_name": "...",
      "to_plant_id": "uuid", "to_plant_name": "...",
      "dc_count": 8, "dispatched_kg": 4_200, "received_kg": 0,
      "avg_transit_days": 1.6
    }
  ]
}
```

### 7B.5 Cell drill-down for roll matrix

Frontend: home page roll matrix → `CellDrawer`. Today the frontend filters `rolls[]` client-side by variant×thickness. For plants with >2k rolls, ship:

```
GET /api/inventory/snapshot/rolls?plant_id=&variant_code=&thickness_um=&cursor=
```

Cursor-paginated response with the same `Roll` shape we already use.

### 7B.6 Plant network metadata

Frontend: inter-plant-v36 KPI strip. Add active flag and capability summary on plants:

```
GET /api/factory/plants?include_capabilities=true
```

So the network map can colour plants by capability (e.g. printing, lamination, slitting) when we extend later.

---

## 7C. Per-class dedicated workspaces

The home page is now a **summary launcher**. Each inventory class has a dedicated workspace at:

| Workspace                  | Route                          | Component                          |
| -------------------------- | ------------------------------ | ---------------------------------- |
| Rolls (matrix/table/grid)  | `/inventory/rolls-v36`         | `rolls-workspace-v36.tsx`          |
| Bulk &amp; chemicals       | `/inventory/bulk-v36`          | `bulk-workspace-v36.tsx`           |
| Packaging                  | `/inventory/packaging-v36`     | `packaging-workspace-v36.tsx`      |
| Inks/adhesives/solvents    | `/inventory/addons-v36`        | `addons-workspace-v36.tsx`         |
| Roll genealogy             | `/inventory/traceability-v36`  | `traceability-v36.tsx`             |
| Inter-plant transfers      | `/inventory/inter-plant-v36`   | `inter-plant-v36.tsx`              |

Each workspace ships with: gradient hero, KPI strip, **saved views bar** (localStorage today), **filter rail** with class-specific filters (search, plant, location, family/kind, health bucket, age, ranges), **active-filter chips** with one-click clear, **multi-view toggle** (matrix / table / grid where applicable), pagination, and a **detail drawer** with reservations.

### 7C.1 Saved views — server persistence (replace localStorage)

Frontend currently persists views in `localStorage` under key `inv-v36-views::<workspace>`. Required:

```
GET    /api/inventory/saved-views?workspace=rolls
POST   /api/inventory/saved-views
PATCH  /api/inventory/saved-views/:id
DELETE /api/inventory/saved-views/:id
```

Schema:
```jsonc
{
  "id": "uuid",
  "workspace": "rolls" | "bulk" | "packaging" | "addons" | "transfers",
  "name": "Aged 90+",
  "icon": "⏰",
  "pinned": true,
  "user_id": "uuid",
  "shared_team": false,
  "state": { /* arbitrary filter object */ },
  "created_at": "ISO",
  "updated_at": "ISO"
}
```

When this lands, frontend swaps `useSavedViews` from a localStorage hook to a React-Query hook hitting these endpoints — no UI change.

### 7C.2 Per-class snapshot endpoints (cursor-paginated)

Today every workspace fetches `inventoryService.getInventorySnapshot()` then filters client-side. For plants with >5k items this is too heavy. Required cursor-paginated endpoints:

```
GET /api/inventory/rolls?plant=&location=&variant=&width_mm=&thickness_um=&status=&role=&age_bucket=&cursor=
GET /api/inventory/bulk?plant=&location=&material_class=&material_family=&health=&cursor=
GET /api/inventory/packaging?plant=&location=&kind=&supply_mode=&health=&cursor=
GET /api/inventory/addons?plant=&location=&family=&material=&health=&cursor=
```

Common response shape:
```jsonc
{
  "items": [ /* class-specific row */ ],
  "next_cursor": "opaque-string-or-null",
  "total": 1245,
  "facets": {
    "plant": [{ "id": "uuid", "name": "...", "count": 412 }],
    "location": [...],
    "family": [...]
  }
}
```

Facets let the filter rail show **counts next to each option** (e.g. `Inks · 142`) without an extra round-trip.

### 7C.3 Reorder &amp; coverage matrix

Bulk and addons workspaces need reorder-point intelligence. Today healt h is computed client-side from a placeholder `reorder_point=200`. Required:

```
GET /api/inventory/coverage?plant_id=&klass=BULK|ROLL|PACKAGING|ADDON
```

Response:
```jsonc
{
  "items": [
    {
      "ref_id": "uuid", "ref_type": "BULK",
      "material_code": "PE-LLD-25",
      "current_stock": 45_600, "reserved": 8_400, "open_demand": 68_200,
      "safety_stock": 18_000, "reorder_point": 25_000,
      "days_cover": 9, "suggested_action": "CREATE_PO" | "TRANSFER" | "EXPEDITE" | "NONE",
      "owner_user_id": "uuid", "owner_name": "..."
    }
  ]
}
```

Frontend will paint the table with action buttons (Create PO, Transfer, etc.) once this is live.

### 7C.4 Bulk &amp; chemicals classification

For the bulk workspace's "material class" filter to be fully accurate, the server should expose a normalised `material_class` field on each `InventoryBulk` row: `"GRANULE" | "INK" | "ADHESIVE" | "SOLVENT" | "CHEMICAL" | "OTHER"`. Frontend has a regex-based classifier as a fallback, but server-classified is preferable.

### 7C.5 Packaging kind enum on response

Same idea for packaging — return a `packaging_kind` enum directly on the snapshot row: `"INNER_POUCH" | "GONNY" | "CARTON" | "TAPE" | "SHEET" | "LABEL" | "TAG" | "POD" | "OTHER"`. Today the frontend does best-effort regex on the code/name.

### 7C.6 Export endpoints

Each workspace's "Export" button currently `alert()`s. Wire to:

```
GET /api/inventory/<class>/export?format=csv|xlsx&<filters>
```

Returns a streamed file. Honor the same filters as `7C.2`.

---

## 7D. Pulse view, GRN History, live Period

This round merged the "Pulse" analytics view into every class workspace, shipped the missing GRN History page with corrections, and made the Period workspace live (auto-detect current FY, "Start FY" button when no open period).

### 7D.1 GRN History page (live, no placeholders)

Frontend: `/inventory/grn-history-v36` (component `grn-history-v36.tsx`). Uses existing service methods:

- `inventoryService.getGrnHistory({})` — must return all inward rows across BULK / ROLL / PACKAGING with `created_at`, `source_type`, `source_id`, `quantity`, `uom`, `vendor`, `plant`, `location`, `material_code`, `material_name`, `label_id`, `batch_no`, `reference`, `avg_cost`.
- `inventoryService.correctGrnHistoryRow(source_type, source_id, payload)` — posts audit-stamped correction returning `{ status, audit_id, delta }`.

Frontend already enforces a soft year-closed lock client-side (rows pre-dating current FY start show "Year-closed"). Server **must** also enforce: reject correction POST with `409 PERIOD_CLOSED` when source date falls inside a `CLOSED` or `LOCKED` period. Override path is the existing FY-correction flow on the period workspace.

Supported filters that should map to query params on `/api/inventory/grn/history/`:

| Frontend filter | Query param         | Notes                                  |
| --------------- | ------------------- | -------------------------------------- |
| source          | `source_type`       | `ROLL` / `BULK` / `PACKAGING`          |
| window          | `from` / `to`       | ISO date pair derived from window enum |
| plant           | `plant`             | plant UUID                             |
| vendor          | `vendor`            | vendor UUID                            |
| search          | `q`                 | full-text across label/material/ref    |
| cursor          | `cursor`            | for >1k rows                           |

Export: `GET /api/inventory/grn/history/?format=csv&<filters>` — frontend already opens this URL.

### 7D.2 Period workspace · Start FY (live)

`/inventory/period` now shows a **"Start {FY label}"** banner when no `OPEN` period exists. The button calls:

```
POST /api/inventory/audit/periods/start/
Body: { "financial_year": "2026-27" }
```

Server should:
1. Compute FY range `start_date = April 1, startYear`, `end_date = March 31, endYear`.
2. Reject if an OPEN period for the same FY already exists.
3. Return the period payload — frontend invalidates `audit-periods` and unblocks all downstream flows.

### 7D.3 Pulse aggregated endpoints

Frontend Pulse-mode aggregates breakdowns client-side from the full snapshot today. For plants >5k rows, please add a single aggregated endpoint per class:

```
GET /api/inventory/<class>/pulse?plant=&location=&family=
```

Response (same shape for rolls / bulk / packaging / addons / grn):

```jsonc
{
  "kpi": { "rows": 0, "total_qty": 0, "reserved": 0, "available": 0, "low_stock": 0, "critical": 0 },
  "primary_breakdown": [{ "label": "PE", "value": 12500, "color": "#6366f1" }],
  "secondary_breakdown": [{ "label": "Plant A", "value": 9000 }],
  "location_breakdown": [{ "label": "WH-A", "value": 5400 }],
  "ageing": { "fresh": 12, "aged": 4, "old": 1 }
}
```

Frontend will swap to this endpoint when live — no UI change.

### 7D.4 Cross-class tab bar

`ClassTabBar` (in `pulse-view-v36.tsx`) drives the **Summary / Roll Explorer / Bulk Inventory / Packaging / Inks · Adhesives / GRN History / Stock Lifecycle / Roll Genealogy / Inter-Plant** tabs across every inventory page. Pure frontend — no backend change.

### 7D.5 Pulse / Browse mode toggle

Every class workspace ships both modes. Pulse = analytics-first (KPI + donut + horizontal bars + ageing + locations). Browse = filter rail + table/grid/matrix. State is local React, not persisted.

---

## 8. Sign-off

When this doc lands, please:
1. File a backend epic (Codex side) referencing this doc.
2. Track per-endpoint status in a checklist on the epic.
3. Notify frontend when each endpoint is staged so the V3.6 components can flip from existing → unified calls.

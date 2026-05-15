# Stock Lifecycle — Audit & Redesign Plan (V3.6)

> **Status:** Discussion document. **No code changes.**
> **Audience:** Product owner + codex implementation agent.
> **Goal:** Audit the current stock lifecycle system (UI + backend), identify what's wrong, propose a clean redesign for the workspace, the backend logic flows, the periodic-count workflow (FY ends 31-March), and the **Day 0 implementation plan** so the system matches the live floor on go-live.

---

## 1. What "stock lifecycle" actually has to handle

In a flexible packaging factory like yours, stock is **not** a single number. It's a moving picture of:

| Class | Identity model | Examples |
|---|---|---|
| **Bulk** | aggregate by `(material, grade, location)` | granules, masterbatch, adhesive, ink, solvent |
| **Roll** | individual identity per roll, parent→child genealogy | extruded film, printed roll, laminated roll, slit roll |
| **Packaging** | aggregate by `(packaging_code, location)` | inner pouches, gunny bags, cartons, tape |
| **POD** | aggregate by `(pod_code, location)` | POD-220, POD-260, POD-300 sleeves |
| **Pouch / Finished Goods** | aggregate by `(variant_code, lot, location)` | finished SNK-250 pouches packed in inner-24 + gunny |

**Every transition** has to be tracked: receive → store → reserve → issue → consume → produce → store → … → dispatch.

That's the **lifecycle**. Today the system has bits of all of this scattered across 8+ pages with no single mental model.

---

## 2. Audit of what exists today

### 2.1 The pages (frontend)

```
/inventory/stock-lifecycle      ← claims to be the hub but is overloaded with tabs
/inventory/stock                ← stock position tracking (bulk + rolls + packaging mixed)
/inventory/grn                  ← create receipts (3 separate forms for bulk / roll / packaging)
/inventory/movements            ← raw movement log
/inventory/ledger               ← running ledger view (overlaps with stock card)
/inventory/traceability         ← genealogy / parent-child rolls
/inventory/roll-explorer        ← roll-level deep dive
/inventory/bulk-transactions    ← bulk-only movement log
/inventory/opening-stock        ← Day 0 entry
/inventory/year-close           ← FY-end close
/inventory/fy-correction        ← post-close correction
```

**Observations:**
1. **Eight-plus pages for one concept.** A user has to remember which page does what — friction every time.
2. **Three GRN forms** (bulk / roll / packaging) instead of one smart receipt form.
3. **"Movements" + "Ledger" + "Bulk transactions" all show overlapping data**, just filtered differently.
4. **Year-close + FY-correction + Opening-stock are three separate pages** but they're all part of the same workflow (period close → next period opens).
5. **Audit batches (physical count)** live inside `stock-lifecycle-workspace.tsx` as a tab — discoverable only after landing on the right page.
6. **Nowhere does a single screen show: "what's on hand, where, in what state?"** That should be the home page.

### 2.2 The components

```
stock-lifecycle-workspace.tsx          ← the kitchen sink; tabs for opening / count / cards / close
inventory-workspace.tsx                ← stock position view
inventory-audit-workspace.tsx          ← audit batch workflows (count cycles)
quick-stock-launcher-dialog.tsx        ← rapid stock-launcher trigger (planner side)
inventory-select-dialog.tsx            ← material picker reused everywhere
stock-launcher-workspace.tsx           ← planner stock-launch (different concept!)
stock-intelligence-tab.tsx             ← analytics dashboard
```

**The naming alone tells the story.** "Stock launcher" is a planner action; "Stock lifecycle" is an inventory view; both have "stock" in the name and live in different mental models. Users mix them up daily.

### 2.3 The services (`inventory.ts`)

The service exposes ~30 methods. Grouped by intent:

- **Read stock**: `getStockSnapshot`, `getRollStock`, `getBulkStock`, `getPackagingStock`, `getStockCard`, `getLedger` (6 methods for "show me what we have")
- **GRN (receive)**: `createBulkGRN`, `createRollGRN`, `createPackagingGRN`, `getGrnHistory`, `correctGrnHistoryRow` (3 separate creates = 3 different shapes)
- **Audit / Count**: `getAuditPeriods`, `startAuditPeriod`, `getAuditBatches`, `createAuditBatch`, `importAuditLines`, `validateAuditBatch`, `submitAuditBatch`, `approveAuditBatch`
- **Period close**: `beginPeriodClose`, `closePeriod`, `getClosingPreview`
- **Movements**: `getBulkTransactions`, `getPackagingTransactions`, `getChallans` (3 movement queries)
- **Reservations / Job work**: `reserveRolls`, `splitRoll`, `getJobWorkEligibleRolls`
- **Inter-plant**: `createOrder`, `dispatchOrder`, `receiveOrder`, `dispatchChallan`, `receiveChallan`

This is **the real complexity** — and it's faithful to the reality. The service isn't the problem; the **way it's surfaced in the UI is the problem.**

### 2.4 The backend (Django apps)

`apps/inventory/models.py` is well-modeled:

- **Stock state**: `InventoryRoll`, `InventoryBulk`, `PackagingStock`
- **Movements**: `BulkTransaction`, `RollMovement`, `RollConsumption`, `PackagingTransaction`
- **Genealogy**: `RollLink` (parent ↔ child)
- **Snapshots**: `InventorySnapshot` (period-end frozen view)
- **Audit**: `InventoryAuditBatch`, `InventoryAuditLine`
- **Period**: `InventoryFinancialPeriod`
- **Inter-plant**: `DeliveryChallan`, `InterPlantChallanItem`
- **Reservations**: `InventoryReservation`, `InventoryAllocation`
- **Corrections**: `InventoryCorrectionAudit`

The model is **right**. The frontend just doesn't use it coherently.

---

## 3. The gaps — what's broken

| Gap | Impact |
|---|---|
| **No single "stock home"** | User has to know which of 8 pages to open. Most-asked question: *"what do I have right now?"* — answered nowhere clearly. |
| **3 GRN forms instead of 1 smart form** | Same form, different fields hidden behind tabs. Trains users to memorize layout instead of one mental model. |
| **No visual stock movement timeline** | Movements are tables. You can't *see* a bulk lot deplete or a roll travel from extrusion to dispatch. |
| **Roll genealogy buried in /traceability** | The most powerful feature (roll lineage) is hidden in a separate page. It should appear contextually. |
| **Audit (physical count) workflow is opaque** | Tab inside lifecycle page. Steps not clear: when to count, who imports, who validates, who approves. No mobile-friendly count screen. |
| **Period-close is scary** | Three pages (year-close, fy-correction, opening-stock) for one workflow. Users avoid running it. |
| **No stock-launcher / lifecycle bridge** | When a sales order arrives and triggers auto-demand, the user can't see "this stock launcher came from this SO" → confusion when closing month. |
| **No "where is this material being used right now?"** | Reservations exist in backend; not visible in UI. |
| **No floor-sync mode for Day 0** | When you go live, opening stock has to be entered for ~hundreds of items in <1 day or production stalls. No bulk import / mobile-first / reconcile UI. |
| **No "anomaly" detection** | When a count differs from system by >5%, no alert. Silent drift. |

---

## 4. Proposed redesign — three big moves

### Move 1: Collapse to **one Stock workspace** with three sub-views

Replace **8 pages** with **1 workspace** that has three tabs of intent (not implementation):

```
Stock workspace
├── 1. WHAT WE HAVE        (the home view — position + activity)
├── 2. WHAT'S MOVING       (movements timeline + roll genealogy + reservations)
└── 3. PERIOD MANAGEMENT   (audit batches + close + opening / corrections)
```

Each tab has its own visual language but shares a sticky header with global filters: location · material · class · date range.

**Why:** every inventory question fits into one of the three buckets.

### Move 2: Make GRN one **smart receipt form**

Today: 3 forms (bulk / roll / packaging). Tomorrow: 1 form that adapts based on what you're receiving.

```
┌─ NEW RECEIPT ─────────────────────────────────────────────┐
│ What are you receiving?                                    │
│ [● Bulk granules] [○ Film roll] [○ Packaging]              │
│                                                             │
│ ─── Source ──────────────────────────────────────────────  │
│ [PO ▼ PO-2025-0042 · Acme Petrochem · 5 lines]              │
│ Vehicle / LR # ........  Driver name ........               │
│                                                             │
│ ─── Items received (table) ──────────────────────────────  │
│ Material            Lot/roll #    Qty    UOM   Location    │
│ LD-PE granules      LOT-2025-…    3,000  KG    BLK-WH-A   │
│ LD-PE granules      LOT-2025-…    1,500  KG    BLK-WH-A   │
│ + Add line                                                  │
│                                                             │
│ ─── Quality ──────────────────────────────────────────────  │
│ ☑ Vendor COA attached   ☐ In-house QC needed                │
│                                                             │
│ [Save draft]  [Submit & post to ledger →]                   │
└────────────────────────────────────────────────────────────┘
```

The form picks fields based on the class — but the user always sees the same shape: source → items → quality → submit.

### Move 3: Make movements **visual, not tabular**

Today: a table of rows. Tomorrow: a timeline / Sankey / map view that shows stock moving.

For one bulk lot:
```
LD-PE granules · LOT-2025-08-19
─────────────────────────────────────────────────────────────
RECEIVED 2025-08-19  ──→  WH-A     5,000 KG
                            │
ISSUED 2025-08-22    ──→  Extruder M1   1,200 KG  → ROLL-EXT-9912
ISSUED 2025-08-25    ──→  Extruder M1   1,500 KG  → ROLL-EXT-9938
ISSUED 2025-09-01    ──→  Extruder M2     800 KG  → ROLL-EXT-9961
COUNTED 2025-09-30   ──→  WH-A     1,475 KG  (system 1,500 KG · variance -25 KG)
ADJUSTED 2025-09-30  ──→  WH-A     1,475 KG  (audit-batch AB-2025-09)
─────────────────────────────────────────────────────────────
```

For a roll, the **same timeline + a parent/child tree** branching into the laminate, slits, and finally the pouch master batch.

---

## 5. The 3 sub-views in detail

### 5.1 Sub-view 1 — "What we have"

Single-screen position view. Top section is a **3-tile KPI row**, then a unified table with smart filters.

```
┌─ 1. What we have ──────────────────────────────────────────────────┐
│ ┌─ BULK ──────────┐ ┌─ ROLLS ─────────┐ ┌─ PACKAGING ───────────┐  │
│ │ 12,400 KG       │ │ 287 active      │ │ 45,000 PCS             │  │
│ │ across 24 mat'l │ │ 4 locations     │ │ INNER, GUNNY, TAPE…    │  │
│ │ ●●●○ healthy    │ │ ◐◐○ aging       │ │ ●●●● healthy           │  │
│ └─────────────────┘ └─────────────────┘ └────────────────────────┘  │
│                                                                      │
│ Filter: [Class ▼] [Location ▼] [Material ▼] [Search…] [As of: today ▼]│
│                                                                      │
│ ┌──────┬───────────────┬────────────┬───────┬───────┬─────────────┐ │
│ │CLASS │ MATERIAL       │ LOCATION   │ ON HAND│ RESERVED│ AVAILABLE │ │
│ ├──────┼───────────────┼────────────┼───────┼───────┼─────────────┤ │
│ │BULK  │ LD-PE-NAT      │ WH-A       │ 4,200 │   600 │ 3,600 KG     │ │
│ │BULK  │ PET-12         │ WH-A       │ 1,100 │   200 │   900 KG     │ │
│ │ROLL  │ ROLL-EXT-9912  │ WCM-PRT-1  │  400  │   400 │     0 KG     │ │
│ │PACK  │ INNER-POUCH-24 │ PACKING    │ 1,200 │   200 │ 1,000 PCS    │ │
│ └──────┴───────────────┴────────────┴───────┴───────┴─────────────┘ │
│ 4 of 358 items shown                          [Export] [Print]      │
└──────────────────────────────────────────────────────────────────────┘
```

Click any row → drawer shows that material's stock card (last 30 movements, current reservations, alerts).

### 5.2 Sub-view 2 — "What's moving"

A timeline + a movement table. Default view: today + last 7 days.

```
┌─ 2. What's moving · last 7 days ──────────────────────────────────┐
│ Activity heatmap (24 hours × 7 days)                                │
│                                                                      │
│ [filter: GRN · ISSUE · CONSUME · TRANSFER · ADJUSTMENT · DISPATCH]   │
│                                                                      │
│ 09:14  GRN          LD-PE-NAT       +3,000 KG   from PO-2025-0042   │
│ 09:18  GRN          PET-12          +500 KG     from PO-2025-0042   │
│ 10:42  ISSUE        LD-PE-NAT       -1,200 KG   to Extruder M1      │
│ 10:45  ROLL CREATED ROLL-EXT-9912   +400 KG     at WCM-PRT-1        │
│ 11:30  CONSUME      ROLL-EXT-9912   -200 KG     by Pouching M3      │
│ 14:00  DISPATCH     SO-1245         12 gunny    to A.K.Poly         │
│ ...                                                                  │
│                                                                      │
│ Click any row → roll genealogy + stock card slide-over               │
└──────────────────────────────────────────────────────────────────────┘
```

A toggle in the header switches to **Sankey view**: shows which materials are flowing into which work centers / which products. Visual, not tabular.

### 5.3 Sub-view 3 — "Period management"

This is the most underbaked piece today. Make it a **clear 4-step ribbon**.

```
┌─ 3. Period management · FY 2025-26 (Apr 2025 → Mar 2026) ──────────┐
│                                                                      │
│ Current period: Sep 2025 (open since Sep 1, 30 days in)              │
│                                                                      │
│  Step 1            Step 2          Step 3          Step 4            │
│  ┌──────────┐      ┌──────────┐    ┌──────────┐    ┌──────────┐      │
│  │ AUDIT    │ ───→ │ VARIANCE │ →  │ APPROVE  │ →  │ CLOSE    │      │
│  │ count    │      │ review   │    │ adjust   │    │ period   │      │
│  │ ────────  │      │ ────────  │    │ ────────  │    │ ────────  │      │
│  │ ● done    │      │ ◐ in prog │    │ ○ open    │    │ ○ open    │      │
│  └──────────┘      └──────────┘    └──────────┘    └──────────┘      │
│                                                                      │
│  Latest audit batch: AB-2025-09-A · 142 lines · 4 variances flagged  │
│  [Open audit batch →]                                                │
│                                                                      │
│  Once Step 4 runs, the next period opens with closing as opening,    │
│  and movements are locked in the closed period.                      │
└──────────────────────────────────────────────────────────────────────┘
```

Year-end (31-March) is just **one period close that triggers FY rollover**. Clear flow:
1. **Last week of March:** start year-end audit (full count, every location).
2. **By 31-March 17:00:** counts submitted, variances flagged.
3. **31-March late:** Variances reviewed + adjusted.
4. **Apr 1 morning:** Period closed. New FY's opening stock = closed FY's closing stock. Opening journal entries auto-generated.

The same flow runs every month, just with smaller scope. Year-end is the same flow with a **larger banner + more sign-off gates + fixed-asset reconciliation hooks**.

---

## 6. Backend logic flows (state machines + invariants)

### 6.1 The four key state machines

#### Bulk stock state
```
   ┌──────────┐
   │ NEW      │  (just received, awaiting QC if required)
   └────┬─────┘
        ▼
   ┌──────────┐  ◀─── reservation hold ─── ┐
   │ AVAILABLE│                            │
   └────┬─────┘                            │
        ▼                            ┌─────┴─────┐
   ┌──────────┐                      │ RESERVED  │
   │ ISSUED   │ ─→ to a job/machine  └───────────┘
   └────┬─────┘
        ▼
   ┌──────────┐
   │ CONSUMED │  (logged via MaterialConsumptionLog)
   └──────────┘
```

#### Roll state
```
NEW (extruded / received) → AVAILABLE → RESERVED → ISSUED → IN-USE → CONSUMED
                                              ↓
                                         (split into children, parent CONSUMED)
                                              ↓
                                         (sold / dispatched, status = DISPATCHED)
```

#### Audit batch state
```
DRAFT → SUBMITTED → VALIDATED → APPROVED → POSTED
              ↓
           REJECTED (back to DRAFT for fix)
```

#### Period state
```
OPEN → CLOSING (no new movements accepted, audit reconciliation in progress) → CLOSED
                                                                                  ↓
                                                                              REOPENED (rare; admin only)
```

### 6.2 The invariants (what backend MUST enforce)

1. **Conservation**: every IN movement equals an OUT somewhere. `sum(IN) - sum(OUT) = on_hand` per `(material, location)` always.
2. **Genealogy**: a child roll's qty + waste = parent roll's qty (parent CONSUMED state on full split).
3. **Reservation respect**: `available = on_hand - reserved`. Cannot issue more than available.
4. **Period lock**: once a period is `CLOSED`, no transactions with `transaction_date <= period_end_date` may be inserted/edited.
5. **Audit reconciliation**: an audit batch with status APPROVED writes adjustment transactions equal to `(counted - system)` per line.
6. **Opening stock seed**: `period.opening_balance = previous_period.closing_balance` for every `(material, location)` — auto-derived, not editable except via FY-correction (audit-trail flagged).

### 6.3 The endpoints that need to exist (some already do)

| Endpoint | Purpose |
|---|---|
| `GET /api/inventory/snapshot/?as_of=YYYY-MM-DD` | Stock position at any point in time (re-derive from ledger) |
| `GET /api/inventory/movements/?date_from=&date_to=` | Movement timeline (multi-class) |
| `GET /api/inventory/stock-card/<material>/<location>/` | Per-material card |
| `GET /api/inventory/rolls/<id>/genealogy/` | Roll family tree ✓ exists |
| `POST /api/inventory/grn/` | **Unified** GRN (replaces 3 separate endpoints). Class inferred from payload. |
| `POST /api/inventory/audit/batches/` | Create count batch ✓ exists |
| `POST /api/inventory/audit/batches/<id>/import/` | Bulk import counted lines ✓ exists |
| `POST /api/inventory/audit/batches/<id>/submit/` | Lock counts, generate variance report ✓ exists |
| `POST /api/inventory/audit/batches/<id>/approve/` | Post adjustments to ledger ✓ exists |
| `POST /api/inventory/periods/<id>/close/` | Close period; write closing snapshot ✓ exists |
| `POST /api/inventory/opening-stock/` | Day-0 / FY-correction entry. Validates not-in-closed-period. |
| `GET /api/inventory/anomalies/` | List flagged variances and alerts |
| `GET /api/inventory/health/` | KPIs ✓ exists |

Most exist. The **unified GRN** is the single biggest backend change.

---

## 7. Stock count workflow — monthly + ad-hoc + year-end

### 7.1 Monthly count (the routine)

**Frequency:** end of every month, ~3-5 working days before month-end.

**Actors:**
- Floor supervisor → walks the floor, scans/writes counts
- Inventory clerk → uploads the count file or types it in
- Plant manager → reviews variances, approves
- Accounts → posts adjustments after approval

**Flow on the system:**

```
Day -3:  Plant manager creates audit batch AB-2025-09-A
         Scope: all bulk + active rolls + packaging
         Frozen list: snapshot of system on-hand at that moment
         Status: DRAFT
            ↓
Day -3 to Day 0:  Floor supervisor counts physically
         Inventory clerk imports CSV / fills in mobile UI
         Each line: counted_qty, counted_by, counted_at
         Status: still DRAFT (multiple imports allowed)
            ↓
Day 0:   Plant manager submits batch
         Status: SUBMITTED → variance report generated
         Lines with |variance| > threshold (default 2%) flagged
            ↓
Day 0/+1: Plant manager reviews each flagged variance
         Reasons logged: spillage, shrinkage, miscount, recount-needed
         Status: VALIDATED
            ↓
Day +1:  Plant manager approves
         Status: APPROVED → adjustment transactions posted
         Each line: ADJ-IN if counted > system, ADJ-OUT if counted < system
         Posted to InventoryLedger with reason code
            ↓
Day +1:  Period close runs
         Closing snapshot frozen
         Next period auto-opens with these as opening balances
```

### 7.2 Ad-hoc / random count

User: *"someone reports the gunny stack looks light, I want to count packaging this Friday."*

System: same audit batch flow, but **scoped narrower**:
- Audit batch type = `PARTIAL`
- Scope = `(class=PACKAGING, location=PACKING)`
- Same DRAFT → SUBMITTED → VALIDATED → APPROVED → POSTED states
- No period close required — adjustments post straight to current period

UI affordance: a **"Quick count" button** in sub-view 3 that creates a partial batch with one click after picking the scope.

### 7.3 Year-end (31-March) count — the big one

This is the same flow with stricter gates and longer scope:

```
Mar 25:  Pre-close communications. Plant manager creates audit batch
         Scope: ALL classes, ALL locations
            ↓
Mar 26-30: Multi-day count. Each location signed off by supervisor
            ↓
Mar 30 EOD: Counts submitted. Variance report generated.
         "Above threshold" gate now stricter (1% for bulk, 0% for rolls).
            ↓
Mar 31 morning: Plant manager + accountant review every flagged variance
         CFO sign-off required for adjustments > ₹X
            ↓
Mar 31 EOD: All approvals in. Adjustments posted.
            ↓
Apr 1 first work day: Period close runs.
         FY 2025-26 → CLOSED.
         FY 2026-27 → OPENED.
         Opening stock seeded automatically.
         Year-end report exported (statutory format).
            ↓
Apr 1 onwards: New FY operates with opening = closing of FY 2025-26.
         Any further changes to FY 2025-26 require explicit
         "FY-correction" with full audit trail (no silent edits).
```

UI affordance: a **"Year-end mode"** toggle that lights up the workspace from Mar 25 onwards. Banner reminds users of the timeline. Period close button becomes "Close FY 2025-26" instead of "Close September".

---

## 8. Day 0 implementation playbook (the go-live)

This is the **highest-risk** day. If it goes wrong, production stalls because no one knows what's on hand.

### 8.1 The 6 things that must happen on Day 0

| # | What | Who | When |
|---|---|---|---|
| 1 | **Master data ready** (materials, products, locations, customers, vendors) | Data team | T-7 days before go-live |
| 2 | **Opening stock entered** for every (material, location) | Inventory team | T-1 evening + T-0 morning |
| 3 | **Open POs and SOs imported** (in-flight orders) | Sales / Procurement | T-0 morning |
| 4 | **Active rolls registered** with current location and qty | Floor supervisor | T-0 morning |
| 5 | **Active jobs in progress** registered as IN-PROGRESS | Production lead | T-0 morning |
| 6 | **First period explicitly opened** for current month | Plant manager | T-0 morning |

### 8.2 Opening stock entry — three modes

For #2 above, give three modes depending on volume:

**Mode A — Bulk CSV import (recommended for >100 items)**
```
Template columns: class, material_code, location_code, qty, uom, lot_id, unit_cost
                  best_before, vendor_lot_id, notes
Validation: every material exists, every location exists, qty > 0
Preview screen: "342 lines · 38 errors flagged → fix or skip"
Submit: bulk insert into ledger as OPENING-BALANCE transactions
        period_id = current period
        date = T-0 00:00:00
```

**Mode B — Manual entry by location (good for <100 items)**
```
Pick location → list materials with empty fields → fill in qty → save.
Save creates OPENING-BALANCE transactions per row.
```

**Mode C — Mobile count → upload (Day 0 floor walk)**
```
Mobile-friendly count screen: pick location, scan/select material,
type counted qty + UOM. Submit when done at that location.
Backend accepts these as OPENING-BALANCE if no opening exists yet,
or as ADJUSTMENT if opening was provisionally set.
```

### 8.3 Day 0 timeline (concrete)

```
T-3 days:  Master data finalized in production system.
           Locations + materials + products published.
           Run dry-run import of 50 representative items, validate.

T-1 day evening (after last shift):
           - Bulk CSV import for granules + chemicals (Mode A)
           - All warehouse locations covered
           - Result: 90% of bulk stock entered

T-0 morning, 06:00:
           - Plant opens, but production halted on system side
           - Floor walk by supervisors with mobile (Mode C)
             counting active rolls, packaging, partial bins
           - As they finish each location, that location is
             marked READY in the system
           - Open POs imported (CSV)
           - Open SOs imported (CSV)
           - Active jobs registered

T-0 morning, 09:00 onwards:
           - First job released through new system
           - Production resumes
           - Period explicitly opened
           - Gradient-coloured banner: "Day 0 — opening stock locked at 09:00"
           - Any post-09:00 corrections go through FY-correction flow

T-0 EOD:   Day 0 review. Plant manager validates that:
           - On-hand reconciles with floor for spot-checked items
           - Production logged consumption against valid stock
           - No "no opening stock" errors fired during the day
           - Variances < 2% — if more, schedule corrective audit batch
```

### 8.4 What the UI needs for Day 0 (and only for Day 0)

- A **"Day 0 mode"** banner at the top of every inventory page (auto-disappears after T-0 +7 days)
- A **"Opening Stock Wizard"** as a first-class button on the home page
- The wizard has three tabs: CSV import (mode A), Manual entry (mode B), Mobile count (mode C)
- A **completion meter** at the top: *"Opening stock complete: 87% (288 of 332 items)"*
- A **"Block production until X% complete"** safety toggle (defaults: 95%)
- After Day 0 +7 days, the wizard disappears; same actions become "FY-correction" with stricter audit

---

## 9. The four pages — what each becomes

| Today | Tomorrow |
|---|---|
| `/inventory/stock-lifecycle` | becomes the home — replaced by `/inventory` with three sub-views described in §5 |
| `/inventory/stock` | folded into sub-view 1 |
| `/inventory/grn` | becomes a **modal** "+ Receive stock" launched from sub-view 1 or 2 |
| `/inventory/movements` | folded into sub-view 2 |
| `/inventory/ledger` | folded into sub-view 2 (toggle between timeline and ledger view) |
| `/inventory/traceability` | becomes a **side drawer** invoked from any roll click |
| `/inventory/roll-explorer` | folded into sub-view 1 (filter to rolls) + drawer |
| `/inventory/bulk-transactions` | folded into sub-view 2 |
| `/inventory/opening-stock` | folded into sub-view 3 → "Opening Stock Wizard" |
| `/inventory/year-close` | folded into sub-view 3 → period management ribbon |
| `/inventory/fy-correction` | folded into sub-view 3 → "Make a correction" action |

**11 pages → 1 page with 3 tabs + 2 drawers + 1 modal.**

---

## 10. Recommended phased build

**Phase A — backend cleanup (~3-5 days)**
1. Unified GRN endpoint (`POST /api/inventory/grn/`) accepting class-tagged payload.
2. Add `GET /api/inventory/snapshot/?as_of=…` if not already returning historical snapshots.
3. Add `GET /api/inventory/anomalies/`.
4. Tighten period-lock validation on every transaction.
5. Add Day-0 opening-stock bulk-import endpoint with dry-run mode.

**Phase B — sub-view 1 "What we have" (~3 days)**
6. Build the home page with KPI tiles + unified table + smart filters.
7. Stock card drawer (per-material).

**Phase C — sub-view 2 "What's moving" (~3 days)**
8. Movements timeline + heatmap.
9. Roll genealogy drawer.
10. Sankey toggle.

**Phase D — sub-view 3 "Period management" (~4 days)**
11. 4-step ribbon UI (audit → variance → approve → close).
12. Audit batch detail screen with mobile-friendly count input.
13. Period close confirm modal with closing-snapshot preview.
14. FY-correction flow with stronger audit gating.

**Phase E — Day-0 wizard (~2 days)**
15. Opening Stock Wizard (3 modes).
16. Day-0 banner + completion meter.
17. CSV templates + dry-run validation UI.

**Phase F — polish + retire old pages (~2 days)**
18. Redirect old URLs to new sub-views.
19. Remove old components after one safety release.
20. Update user-guides docs.

**Total: ~17 working days for one engineer.**

Phases A + B alone (~8 days) deliver 70% of the daily-life value because the home view + unified GRN are what users touch every day.

---

## 11. Where to start — recommendation

**Start with Phase A backend cleanup + Phase B "What we have" home view.** Reasons:

1. **It's the most-asked question.** "What do I have?" — users open inventory pages 50× a day to answer it. Fixing this fixes most pain immediately.
2. **It's testable.** No breaking change — add the new home view, leave old pages running, switch the nav link, retire old pages later.
3. **It unblocks Day 0.** The opening stock wizard (Phase E) needs the new home view to land users on a sensible screen.
4. **It validates the model.** Once sub-view 1 is in production and users like it, sub-views 2 and 3 follow the same pattern with confidence.

Sub-view 3 (period management + Day 0 wizard) is the most **high-stakes** piece — best built second-to-last, after the home view has a few weeks of real-floor feedback.

---

## 12. Open questions before implementation

1. **Threshold for variance flagging** — 2% for bulk, 0% for rolls? Confirm with plant manager.
2. **CFO sign-off floor** — at what ₹ value does an FY adjustment require CFO approval (vs plant manager)?
3. **Period close cadence** — strict monthly, or align with payroll / GST cycles?
4. **Multi-plant rollout** — Day 0 per plant, or all plants on one cutover day? Affects bulk-import endpoint shape.
5. **Audit batch scope defaults** — should monthly batches default to "all classes all locations" or be smaller chunks?
6. **Mobile count UI** — separate PWA, or responsive view inside the same workspace?
7. **Reservation visibility for sales team** — can sales see "this customer has 200 KG of material reserved across 3 SOs"? Today no.

These are the real product decisions. Once answered, the code work is straightforward.

---

## 13. Bottom line

**The data model is good. The UI is the problem.** Eight pages should be one workspace. Three GRN forms should be one. Year-end + month-end + ad-hoc count should be one workflow with different scope.

Day 0 deserves its own first-class wizard so going live doesn't stall production.

**Start with the home view + unified GRN.** Everything else cascades from there.

End of report.

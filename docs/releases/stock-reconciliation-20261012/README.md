# Release: nightly stock reconciliation (false alarms, alert pile-up, gap list)

- **Base:** the live release `9b0a7400d9f6` (`codex/review-hardening-20261011`).
- **Branch:** `codex/stock-reconciliation-20261012`.
- **Why:** every night the inventory check reported 90 bulk stock mismatches and created 90 new alert rows for them (9,204 open `TXN_MISMATCH` alerts by 12 Oct 2026). 70 of the 90 were false alarms; 20 are real gaps that need a physical count.

## What changes

| Area | Change |
|---|---|
| Stock check | Bulk stock is held per material + quality code + location. The check used to compare each quality code's stock with the ledger of **all** codes at that location, so any item split across codes was flagged. It now compares each stock row with its own ledger (`InventoryAuditService.bulk_ledger_gaps`). |
| Alerts | The nightly run keeps **one open alert per condition** (`InventoryAlert.scope_key`, `last_seen_at`) and updates it instead of creating a new one. When the condition clears, the alert is resolved automatically with a note. Applies to `TXN_MISMATCH`, `NEGATIVE_STOCK`, `WEIGHT_MISMATCH`, `ORPHAN_ROLL`, `STUCK_WIP`. Other alert types are untouched. |
| Alert messages | Mismatch messages now name the quality code: `Bulk WHITE-MB [WHITE-57-F] @ Raw Materials Store: …`. |
| API | `GET /api/inventory/alerts/` rows carry `scope_key` and `last_seen_at`. No screen change needed. |
| Commands | `bulk_ledger_gaps` (read-only list for the store team) and `collapse_inventory_alerts` (one-time clean-up of the old pile; idempotent). |

## Deploy checklist
1. Build and activate with the usual release scripts (same pattern as `.runtime/release-review-hardening/`), with the migration plan limited to `inventory.0058_inventory_alert_scope_key` (two nullable/defaulted columns, additive).
2. After activation, once, as root on the host:
   `docker exec aws-backend-1 python manage.py collapse_inventory_alerts --dry-run` then without `--dry-run`. It resolves the legacy open alerts and re-runs the check, leaving one open alert per real gap (expected: 20 `TXN_MISMATCH` + 1 `STUCK_WIP`).
3. Hand the gap list below to the store team: `docker exec aws-backend-1 python manage.py bulk_ledger_gaps --csv`.

**Rollback:** previous images; the two new columns are ignored by the old code. Alerts resolved by the collapse stay resolved (they were duplicates).

## The 20 real gaps (production, 12 Oct 2026, read-only)

All in plant 01, Raw Materials Store. In every row the system shows **more** stock than the ledger explains; no stock is missing on paper, some stock is missing its paper.

| # | Material | Quality code | Stock kg | Ledger kg | Gap kg | Kind |
|---|---|---|---|---|---|---|
| 1 | ANTIBLOCK-AB-220-MB | – | 325.000 | 0.000 | +325.000 | A · no ledger |
| 2 | BLACK-7A-10-F-S-MB | 7A-10-F(S | 325.000 | 250.000 | +75.000 | B · short ledger (last entry 13 Sep) |
| 3 | BLUE-224-FF-MB | – | 25.000 | 0.000 | +25.000 | A · no ledger |
| 4 | FILLER | – | 1200.000 | 0.000 | +1200.000 | A · no ledger |
| 5 | GREEN-1859-FF-MB | – | 50.000 | 0.000 | +50.000 | A · no ledger |
| 6 | HDPE | ACP144 | 0.000 | −25.500 | +25.500 | C · over-issued ledger (last 15 Jun) |
| 7 | IVORY-97-FF-MB | – | 75.000 | 0.000 | +75.000 | A · no ledger |
| 8 | LDPE-NON-SLIP | RIL-22FA002 | 12358.853 | 12321.353 | +37.500 | B · short ledger (last 11 Oct) |
| 9 | LDPE-SLIP | RIL-1005FY-20 | 57346.902 | 57282.402 | +64.500 | B · short ledger (last 11 Oct) |
| 10 | LLDPE-NON-SLIP | 010F18A | 0.000 | −196.800 | +196.800 | C · over-issued ledger (last 26 Jun) |
| 11 | LLDPE-SLIP | F1801SA | 0.000 | −392.025 | +392.025 | C · over-issued ledger (last 15 Jun) |
| 12 | MASTER-BATCH | SLIP-110-C | 2202.496 | 2198.822 | +3.675 | B · short ledger (last 30 Sep) |
| 13 | METALLOCENE-NON-SLIP | F0118-LM | 4420.632 | 4405.632 | +15.000 | B · short ledger (last 11 Oct) |
| 14 | METALLOCENE-SLIP | F0120-LM | 823.735 | 808.735 | +15.000 | B · short ledger (last 11 Oct) |
| 15 | ORANGE-554-MB | – | 25.000 | 0.000 | +25.000 | A · no ledger |
| 16 | RED-329-FF-MB | – | 25.000 | 0.000 | +25.000 | A · no ledger |
| 17 | SLIP-110-C-MB | – | 825.000 | 700.000 | +125.000 | B · short ledger (last 26 Aug) |
| 18 | UV-404-MB | – | 125.000 | 0.000 | +125.000 | A · no ledger |
| 19 | WHITE-MB | WHITE-57-F | 2800.000 | 1000.000 | +1800.000 | B · short ledger (last 10 Oct) |
| 20 | YELLOW-627-FF-MB | – | 125.000 | 0.000 | +125.000 | A · no ledger |

Total 4,725 kg. Kinds:
- **A · no ledger (9 rows, 1,975 kg):** stock entered directly, before the ledger started on 1 Jun 2026, and never given an opening-balance entry. Masterbatches and filler.
- **B · short ledger (8 rows, 2,135 kg):** receipts or counts that reached the stock figure but not the ledger. Row 19 (WHITE-MB, +1,800 kg, last entry 10 Oct) and row 17 (+125 kg) are the ones to check first.
- **C · over-issued ledger (3 rows, 614 kg):** the ledger for that quality code shows more issued than received (negative), and stock is 0. Most likely the material was received under one quality code and issued under another in June. Check whether another code of the same material carries a matching surplus.

## Correction steps (after the physical count; owner approval)

1. **Count** each of the 20 rows (material + quality code) in the Raw Materials Store.
2. **Count equals the stock figure, paper is missing (kinds A and B):** post an **opening-balance adjustment** ledger row (`OPENING_BALANCE_ADJUST`, reference "Ledger reconciliation 2026-10, counted on <date>") for the gap. Stock does not change; the stock card becomes complete. Use the Opening Stock batch screen (Inventory → Count & adjust), which writes exactly this row type.
3. **Count is lower than the stock figure:** draft a **stock adjustment** for the difference with reason "Physical count 2026-10". A second store user posts it (maker-checker). Both stock and ledger move.
4. **Kind C:** if another quality code of the same material shows a matching surplus, post a **stock conversion** between the codes (Move & convert) for the June quantity; otherwise treat as kind A with an opening-balance entry on the issued code.
5. Run `python manage.py bulk_ledger_gaps`: it should print `0 row(s)`, and the nightly alerts resolve themselves the following night.

Nothing in this release changes stock quantities; the corrections above are posted by the store team through the normal screens.

## Verification
- New tests: `apps/inventory/tests/test_bulk_reconciliation.py` (split quality codes raise nothing; a real gap raises one alert that a second run updates rather than duplicates; a corrected gap resolves its alert; the collapse command is idempotent; the gap list is read-only).
- Full backend suite: see the commit message.

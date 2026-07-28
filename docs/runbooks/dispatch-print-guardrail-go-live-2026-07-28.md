# Dispatch printing and physical-unit guardrails — go-live report

Date: 2026-07-28 (IST)  
Release commit: `a23380a` — `Fix dispatch printing and unit reservations`  
Release branch: `codex/planner-sales-latest-20260629`  
Production: `https://erp.totalpolyprint.com`

## Outcome

The dispatch and packing-slip paths now have two explicit printer contracts:

- **Epson tractor print** downloads a validated `TPPPRINT/1` RAW ESC/P job for the EPSON FX-2175II and 15 × 5.5-inch half-form.
- **A4 PDF · normal printer** creates a separate A4-landscape, fill-only vector PDF for a laser or inkjet printer.

The Epson job selects 10 CPI Roman NLQ and unidirectional printing, cancels global emphasis/double-strike for normal body rows, selectively emphasizes only headings/totals, and ends each physical form with Form Feed. The A4 PDF uses 12 pt Courier with safe hardware margins and no outline/raster darkening.

Each slip now states **ONE SO**, uses the actual SO item number, prints one row per physical unit, and shows balances only for SO items physically present on that slip. Redundant line groups, subtotals, and unrelated parent-order balances were removed.

## Dispatch integrity controls

- Exact, non-empty, unique UUID selections are mandatory.
- Every roll/gonny is locked and revalidated at challan creation and again before dispatch.
- Sales order, SO item, plant, physical status, packing release, weight, and unit lineage must all agree.
- Cross-order, cross-plant, stale, duplicate, unavailable, unreleased, terminal-line, or directly batched selections fail closed.
- New draft challans reserve physical units immediately.
- Partial unique indexes prevent concurrent double-reservation of a roll or gonny.
- Only an unmoved draft challan can be cancelled and release its reservation.
- Post-dispatch cancellation/return is blocked until a complete atomic return-to-stock workflow exists.
- PostgreSQL advisory locking serializes daily DC-number allocation across workers.
- Frozen dispatch snapshots are versioned and validate document reference, document type, order identity, non-empty physical rows, and row-level order/line lineage before printing.

## Local release evidence

- Focused print, reservation, lineage, and POD suite: **53 passed**.
- Full backend suite: **960 passed**, zero failures.
- Django system check: passed.
- Migration drift check: no changes detected.
- Frontend typecheck: passed.
- Optimized Next.js production build: passed.
- `git diff --check`: passed.
- Windows helper archive: seven expected files; archive contents byte-match source.
- Visual PDF QA: one A4-landscape page, 110 columns maximum, crisp vector text, safe top/left/right margins, no clipping, overlap, raster blur, or unwanted second page.

Visual proof files in the verified checkout:

- `output/pdf/dispatch-print-regression-a4.pdf`
- `tmp/pdfs/dispatch-print-regression-a4.png`

## AWS deployment evidence

Before migration, an encrypted deployment backup was created and checksum-verified:

- `/opt/tpp-erp/backups/daily/tpp-erp-db-20260728-123352+0530.sql.gz`
- SHA-256 sidecar verification: `OK`

Deployment steps completed:

- Synced a clean detached export of commit `a23380a` to `/opt/tpp-erp/app`.
- Built production backend and frontend images successfully.
- `python manage.py check`: passed.
- Reviewed the migration plan and applied `production.0070_delivery_challan_item_reservations`: passed.
- Force-recreated backend, frontend, worker, and beat.
- Backend and frontend reported healthy; PostgreSQL and Redis remained healthy; worker and beat remained running.
- Backend/frontend post-deploy logs contained no traceback, error, critical, unhandled, or exception entries.

Public probes:

- `/api/health/ready/`: HTTP 200, `application/json`.
- `/logistics/dispatch`: HTTP 200, HTML.
- `/downloads/epson-fx2175ii/tpp-epson-print-helper.zip`: HTTP 200, `application/zip`, 8,076 bytes.

The server source and running container hashes match the local committed source for the dispatch model, renderer, service, migration, dispatch UI, and helper ZIP.

## Live business-data verification

The two photographed examples were rendered inside the live production backend:

| Challan | Parent SO | Physical units | Text pages | Max columns | Printed SO balances | PDF pages |
|---|---|---:|---:|---:|---:|---:|
| `DC-20260713-0005` | `SO-2026-0016` | 8 | 1 | 110 | 2 | 1 |
| `DC-20260713-0006` | `SO-2026-0017` | 16 | 1 | 110 | 3 | 1 |

Live post-migration invariants:

- Draft challans: `0`.
- Active reservations on historical rows: `0`.
- Cross-order challan items: `0`.
- Database check constraint present: `active_dc_reservation_has_one_unit`.
- Partial unique indexes present: `uniq_active_dc_roll_reservation`, `uniq_active_dc_gonny_reservation`.

There are 46 historical rolls that already appear in duplicate non-cancelled challans created before this release. They were deliberately preserved, left inactive, and not silently corrected. The new picker and creation guard block them from being selected again. Client confirmation is required before any historical business record is cancelled or reconciled.

## Windows helper

Client download:

`https://erp.totalpolyprint.com/downloads/epson-fx2175ii/tpp-epson-print-helper.zip`

The simple client procedure is maintained in:

`docs/runbooks/windows-epson-fx2175ii-client-setup.md`

The previously installed v2 helper remains compatible with the new job prefix. Install v2.1 on a new Windows user/computer, after changing the printer queue, or when the helper log does not report normal-body 10-CPI NLQ unidirectional mode.

## Physical acceptance boundary

The ERP layout, data lineage, PDF vector output, RAW ESC/P bytes, helper package, live renderer, and deployed routes are verified. Final ink density still depends on the physical FX-2175II ribbon, print-head gap, paper thickness, and tractor alignment. If the printer's own NLQ self-test is faint or doubled, replace/service the ribbon or adjust the head gap; changing ERP layout or rerunning deployment will not correct a hardware self-test defect.

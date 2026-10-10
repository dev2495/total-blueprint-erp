# Release: bills & documents, outward evidence, gate passes, general receipts and job work

- **Base:** the live AWS release `38ca792b` (`origin/codex/bill-intake-live-20261008`).
- **Branch:** `codex/documents-jobwork-20261010`.
- **Specification:** `docs/documents-jobwork/SPEC.md`.
- **Image storage:** `docs/documents-jobwork/STORAGE.md`.

## What users get
| Area | Change |
|---|---|
| Bill viewer | The bill stays beside the Smart GRN, the PO receipt, bill details, General Receipt, job-work receive and outward matching screens. Modes: dock split with independent scrolling, floating window, pop-out synced to a second monitor, hidden rail, and a bottom sheet on phones. You can fit width, zoom, pan, rotate (saved for everyone), pin a region, and use shortcuts. |
| Bills & documents | One register for every bill. **Inbox:** needs classifying, waiting for receipt, partly received. **All documents** and **Filed:** searchable, with CSV export. **Non-stock follow-ups**, and **Reports**, including a storage card for Owner/Admin. |
| Office upload | Inventory can upload photos or PDFs that came by post or email. PDFs are rendered to pages and the original is kept. |
| Classify | Each bill gets a type, category, vendor or party, bill number and date, amounts, due date, valid-until and ship-to factory. Duplicate bills are flagged. The next step depends on the category: stock goes to a GRN, job work to a job-work receipt, spares/machinery/services to a General Receipt, and utilities, fees, transport and notes are filed (or attached to another bill). |
| General Receipts | Record who received the goods or confirmed the service, linked to the machine, and close lines on returnable gate passes. **Never changes stock.** Includes a machine history view. |
| Outward | The watchman scans the QR on ERP papers, photographs the pages and records the departure. The office matches each departure to its ERP document. **Never moves stock.** |
| Gate passes | Returnable (RGP) and non-returnable (NRGP) gate passes, numbered and printed with a QR. RGPs track items until they come back, with overdue alerts. |
| Job work | Order → Rule 45 challan with QR → reconciled returns (finished pieces in boxes, output rolls, balance rolls, wastage) with a material-balance check → bill linked and checked against the vendor rate card → close, which completes the route step. Includes ageing/ITC-04 and yield reports, overdue alerts, and a one-time owner screen for orders stuck before the upgrade. |
| Fixes | Smart GRN no longer offers "Job work return", which double-counted stock. Job work no longer leaves phantom rolls at JOBWORK_OUT. GRNs into virtual locations are refused. Challan PDFs print factory time. |
| Rights | Bill and document rights belong to Inventory (Store) by default; Owner/Admin always have them. Grant them to other roles or users under Role matrix → "Bills & documents", or in the user override editor. Watchman can never have office rights. |

## Deploy checklist (AWS Lightsail, compose project `aws`)
1. Hash-compare the live release dir with `38ca792b` (it must be unchanged since 8 Oct). Never rsync the whole local tree.
2. Take a backup: `pg_dump` into `/opt/tpp-erp/backups`, then run the restore drill.
3. Tag rollback images: `tpp-erp-{backend,frontend}:rollback-38ca792b63e1`.
4. Run `cp -a` on the live release dir and overlay `git archive` of this branch's HEAD, then point the `app` symlink at the new dir.
5. `docker compose build backend frontend worker beat`. New dependencies:
   - backend: `pypdfium2==5.13.0` (hash-pinned in requirements.txt)
   - frontend: `jsqr@1.4.0` (lockfile)
6. `migrate`. The migrations are additive, and any new NOT NULL column on an existing table has a `db_default`, so the previous image can still insert rows. They are:
   - `gate.0004_documents_outward_gate_passes`: register columns; outward, gate-pass, page-view, original-file and sequence tables; immutability triggers.
   - `gate.0005_backfill_document_headers`: copies the vendor/invoice of previously reviewed bills into the new columns, without overwriting anything.
   - `procurement.0006_general_receipts`
   - `inventory.0054_job_work_documents`: challans, sent/return lines, settlements and order fields.
   - `inventory.0055_backfill_job_work_numbers`: legacy order numbers `JWO-L-…` and PARTIAL → PARTLY_RETURNED; no stock is touched.
   - `production.0074_jobwork_waste_scrap_reason`
7. `up -d`. Celery beat picks up four daily jobs:
   - document reminders
   - gate-pass overdue
   - job-work overdue
   - document storage monitor
8. Optional environment settings, with defaults:
   - `DOCUMENT_DB_WARN_GB` (25)
   - `DOCUMENT_DISK_FREE_WARN_PCT` (20)
   - `DOCUMENT_BACKUP_COPIES` (6)
9. Smoke test as Owner, Store and Watchman:
   - Bills & documents inbox
   - Smart GRN with a bill
   - Job work list
   - Gate passes
   - Outward documents
   - Watchman: Outward tile with the camera (needs HTTPS for the camera)
   - `python manage.py document_storage_report`
10. After go-live, as Owner, open Job work → "Before upgrade" and reconcile any rolls the old screen left at the job worker.

**Rollback:** re-point the symlink to the previous release and start the rollback-tagged images. The schema is additive, so the old images keep working with the new columns.

## Verification evidence (local, 10 Oct 2026)
- **Backend:** the full suite on a fresh database applies every migration from scratch and passes. Counts are in the final report.
- **Frontend:** `npm run build` passes (typegen, tsc, theme tokens, user-facing label check, next build). ESLint is clean on all changed files. Help coverage and nav-route validators pass, with every page guided in English and Hindi.
- **End to end:** run on a real production build with STRICT_RBAC=True, using the client's 11 sample bills as local, git-ignored test data.
  - watchman inward/outward on a phone
  - every bill route
  - RGP out and back
  - NRGP
  - outward matching
  - the full Vee Dee job-work cycle
  - permission and role-override matrix
  - bill workspace modes
  - regression smoke tests

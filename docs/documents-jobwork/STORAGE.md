# Bill and document images in PostgreSQL

Decision, 10 October 2026: page images for inward bills, outward documents and office PDFs stay in PostgreSQL (`bytea`).

## Why PostgreSQL for now
- **Transactional evidence:** a page is committed in the same transaction as its arrival or departure record and audit row. There are no orphan files and no missing images after a crash.
- **Proven recovery:** the existing `pg_dump` backups (every 4 hours) and the weekly restore drill already cover the images. No second backup system is needed.
- **Tamper resistance:** PostgreSQL triggers refuse UPDATE/DELETE on pages, originals and departure evidence.

## How growth is kept small
| Control | Effect |
|---|---|
| Upload normalisation | Every page is re-encoded to JPEG, max 2400 px and ≤ 2 MiB (typically 250–600 KB for a phone photo of an A4 bill). EXIF rotation is applied. |
| PDF uploads | Each PDF page is rendered once to the same JPEG format, and the original PDF is kept once (max 15 MiB, 20 pages). |
| Thumbnails | Rendered on demand (`?w=160/320/640`) and never stored. |
| Rotation | A shared display preference row (a few bytes). The image is never rewritten. |

Rough sizing: 60 inward + 30 outward pages a day at about 450 KB is about 40 MB/day, or about 15 GB/year. Every retained `pg_dump` also holds a copy, because JPEG does not compress further.

## Monitoring (built in)
- **Daily job:** `document-storage-monitor-daily` (Celery beat, 03:50 UTC) → `apps.gate.storage_monitor.run_storage_monitor`.
- **On demand:** `python manage.py document_storage_report` prints JSON; `--alert` also sends the alerts.
- **Owner/Admin view:** `GET /api/gate/document-reports/storage/`, shown on Bills & documents → Reports.
- **What it measures:** bytes per document table, database size, document share, 30-day growth, free space on the backup volume, and projected days to each threshold.
- **Status values:**
  - `OK`
  - `PLAN_AHEAD` (a threshold is less than 90 days away)
  - `ACTION_NEEDED` (a threshold is crossed): Owner/Admin get one in-app alert per day.
- **Thresholds (env):**
  - `DOCUMENT_DB_WARN_GB` (default 25)
  - `DOCUMENT_DISK_FREE_WARN_PCT` (default 20)
  - `DOCUMENT_BACKUP_COPIES` (default 6, used in the disk projection)

## What to do when the monitor says PLAN_AHEAD or ACTION_NEEDED
1. **Check backups first.** `BACKUP_RETENTION_DAYS` and the 4-hourly schedule multiply image bytes on disk. Reduce retention for old intra-day dumps, or keep only daily dumps after 7 days.
2. **Grow the Lightsail disk.** Attach or resize block storage for `/opt/tpp-erp`. This is the quickest safe step.
3. **Move page bytes to private object storage, with dual-read.** This is a planned code change, not a config switch:
   1. Add a nullable `storage_key` and `storage_backend` (DB | OBJECT) to the page tables, with a `db_default` of `DB`.
   2. Write new pages to a private bucket (S3 or Lightsail Object Storage, block-public-access on, SSE on) and keep `sha256` and `byte_size` in PostgreSQL.
   3. Serve every image only through the existing authenticated endpoints. The server fetches from the bucket and verifies `sha256`; never hand out public or presigned links to watchmen.
   4. Copy old pages in batches, verify each `sha256`, then null the bytea data. Releasing the trigger for this one step needs an Owner-approved migration with a backup taken first.
   5. Add bucket versioning and lifecycle rules, and include the bucket in the restore drill.

Do not delete or downscale existing evidence to save space.

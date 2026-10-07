# Watchman backend validation — 7 October 2026

**Passed: 1,121 backend tests in 137.043 seconds.** Final source remained unchanged throughout the run. Recorded 07 October 2026, 17:19:53 IST.

## Tested source and isolation

- Checkout: `/private/tmp/tpp-watchman-20261007`.
- Base Git commit: `d04c2c06cac24bf6a3c35edcaec6e25ffc7db96f`, plus the watchman feature working-tree changes.
- Backend source SHA-256: `5548b41f06a8d8500ce7ad4bbf338c5ebcc326fec875dcf63569c5a2c5845524`.
- Fingerprint covers 851 files: `apps/**/*.py`, `config/**/*.py`, `requirements.in`, and `requirements.txt`; each sorted path and its contents are separated by NUL bytes before hashing.
- Database: isolated PostgreSQL `test_tpp_gate_full_20261007`, created by Django from overridden base name `tpp_gate_full_20261007`. Production and the browser QA database were untouched by this run.
- Full evidence: ignored local `.runtime/gate-full-server-receipt-regression.log`.

The ignored local runtime environment was loaded without printing credentials, then the base database name was overridden for:

```sh
DB_NAME=tpp_gate_full_20261007 .venv/bin/python manage.py test --noinput --keepdb --verbosity=1
```

`manage.py check`, `manage.py makemigrations --check --dry-run`, and `git diff --check` also passed with no schema drift or whitespace errors.

## Feature coverage

- Actual WATCHMAN role and owner WATCHMAN preview are restricted with ordinary bearer/cookie JWT authentication, canonical role codes, explicit plant assignments, and an independent app permission ceiling. Empty or unassigned gates fail closed.
- Goods entries validate active party/product masters and their real units. GRN, trading receipt, customer dispatch, legacy delivery challan, and dispatched trading-order references are read without posting stock or accounting changes.
- Invoice identity uses the Indian April–March financial year. Duplicate source references, retry payload conflicts, concurrent duplicate goods submissions, and concurrent visitor exits are guarded by transactions and database constraints.
- Public QR submission immediately records INSIDE with one server timestamp for submission, consent and entry. Its safe receipt includes the exact persisted server entry_at and preserves that timestamp on every identical retry. Registration and entry audit evidence are appended atomically exactly once on retry. Watchman visitor permissions allow exit only; manual entry, check-in and cancellation are denied with ordinary JWT authentication and independent service guards. Existing pending rows remain unchanged and owner-only recovery supports admission/cancellation.
- Optional government IDs are encrypted and masked; missing encryption configuration refuses ID storage before committing a visitor. Uploaded selfies are bounded, decoded, stripped of metadata, resized, and stored privately. Anonymous reads are denied; watchman images are restricted to INSIDE visitors at assigned plants, with owner-only pending/closed history access. Authenticated images use no-store, and visitor list queries avoid loading image binaries per row.
- Owner corrections require reasons and preserve before/after events. Audit events are append-only both in application code and through a PostgreSQL update/delete trigger. Delegated reports expose sanitized goods registers and visitor aggregates.
- Watchman queues default to INSIDE and deny every other explicit status filter. Inside queues sort oldest entry first with deterministic tie-breakers; owner pending recovery queues sort oldest submission first. A 125-pending plus 125-inside regression verifies correct priority beyond a 100-row server page and watchman queue isolation. Unfiltered owner history remains newest first.
- New plants automatically receive public QR identities; updates retain the same token. QR SVG uses high error correction and a four-module quiet zone. Public configuration exposes only the selected gate label.
- Scheduled gate report dates, role report permissions, sanitized report rendering, unified owner audit integration, and India-time daily chart buckets are covered alongside the existing ERP suite.

## Local runtime and acceptance boundary

The local API on `http://127.0.0.1:8017` was restarted with the final immediate QR entry, server timestamp receipt and watchman exit-only flow, and `/api/health/` returned HTTP 200. Process 80120 (tool session 27601) remains available for browser QA; its ignored local log is `.runtime/gate-api-server-receipt.log`.

This record establishes backend test and local runtime evidence. Production rollout, authenticated browser acceptance, actual phone camera use, and scanning a physical printed QR are recorded separately by the release owner.

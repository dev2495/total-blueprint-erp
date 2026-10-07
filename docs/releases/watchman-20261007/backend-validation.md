# Watchman backend validation — 7 October 2026

**Passed: 1,127 backend tests in 232.812 seconds.** Final source remained unchanged throughout the run. Recorded 07 October 2026, 18:49:54 IST.

## Tested source and isolation

- Checkout: `/private/tmp/tpp-watchman-20261007`.
- Base Git commit: `f7fbd1b3ae68ed011b020875d62122051fdda825`, plus the owner/admin gate access working-tree changes.
- Backend source SHA-256: `594a76ecc4403caf733e426934d9f2a70b6f4dea2b959cc9559573a1a545bb6e`.
- Fingerprint covers 851 files: `apps/**/*.py`, `config/**/*.py`, `requirements.in`, and `requirements.txt`; each sorted path and its contents are separated by NUL bytes before hashing.
- Database: isolated PostgreSQL `test_tpp_gate_full_20261007`, created by Django from overridden base name `tpp_gate_full_20261007`. Production and the browser QA database were untouched by this run.
- Full evidence: ignored local `.runtime/gate-full-master-policy-regression.log`.

The ignored local runtime environment was loaded without printing credentials, then the base database name was overridden for:

```sh
DB_NAME=tpp_gate_full_20261007 .venv/bin/python manage.py test --noinput --keepdb --verbosity=1
```

`manage.py check`, `manage.py makemigrations --check --dry-run`, and `git diff --check` also passed with no schema drift or whitespace errors.

## Feature coverage

- Actual WATCHMAN role and owner WATCHMAN preview are restricted with ordinary bearer/cookie JWT authentication, canonical role codes, explicit plant assignments, and an independent app permission ceiling. Empty or unassigned gates fail closed.
- Actual ADMIN/SUPER_ADMIN/OWNER accounts and owner/superuser flags receive full gate access through one shared authenticated master helper: all plants, history, private photos, QR/setup, corrections, reconciliation, audit and the gate report pack. Actual or effective WATCHMAN overrides every elevated role/flag. Tests use administrators without owner flags or gate assignments and verify other literal report delegates remain sanitized.
- Goods entries validate active party/product masters and their real units. GRN, trading receipt, customer dispatch, legacy delivery challan, and dispatched trading-order references are read without posting stock or accounting changes.
- Invoice identity uses the Indian April–March financial year. Duplicate source references, retry payload conflicts, concurrent duplicate goods submissions, and concurrent visitor exits are guarded by transactions and database constraints.
- Public QR submission immediately records INSIDE with one server timestamp for submission, consent and entry. Its safe receipt includes the exact persisted server entry_at and preserves that timestamp on every identical retry. Registration and entry audit evidence are appended atomically exactly once on retry. Watchman visitor permissions allow exit only; manual entry, check-in and cancellation are denied with ordinary JWT authentication and independent service guards. Existing pending rows remain unchanged and owner/admin recovery supports admission/cancellation.
- Optional government IDs are encrypted and masked; missing encryption configuration refuses ID storage before committing a visitor. Uploaded selfies are bounded, decoded, stripped of metadata, resized, and stored privately. Anonymous reads are denied; watchman images are restricted to INSIDE visitors at assigned plants, with owner/admin pending/closed history access. Authenticated images use no-store, and visitor list queries avoid loading image binaries per row.
- Owner/admin corrections require reasons and preserve before/after events. Audit events are append-only both in application code and through a PostgreSQL update/delete trigger. Delegated reports expose sanitized goods registers and visitor aggregates.
- Watchman queues default to INSIDE and deny every other explicit status filter. Inside queues sort oldest entry first with deterministic tie-breakers; owner/admin pending recovery queues sort oldest submission first. A 125-pending plus 125-inside regression verifies correct priority beyond a 100-row server page and watchman queue isolation. Unfiltered master history remains newest first.
- New plants automatically receive public QR identities; updates retain the same token. QR SVG uses high error correction and a four-module quiet zone. Public configuration exposes only the selected gate label.
- Scheduled gate report dates, role report permissions, sanitized report rendering, unified owner audit integration, and India-time daily chart buckets are covered alongside the existing ERP suite.

## Local runtime and acceptance boundary

The local API on `http://127.0.0.1:8017` was restarted after the full suite with the exact final shared owner/admin master access policy, immediate QR entry, server timestamp receipt and watchman exit-only flow, and `/api/health/` returned HTTP 200. Process 949 (tool session 75013) remains available for browser QA; its ignored local log is `.runtime/gate-api-master-policy-final.log`.

This record establishes backend test and local runtime evidence. Production rollout, authenticated browser acceptance, actual phone camera use, and scanning a physical printed QR are recorded separately by the release owner.

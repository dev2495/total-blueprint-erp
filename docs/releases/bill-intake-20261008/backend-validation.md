# Bill intake backend validation — 2026-10-08

The final isolated PostgreSQL backend regression passes **1,247 tests in 161.635 seconds**, exit 0. This is local release-candidate evidence; production activation, authenticated production acceptance, physical-device camera checks and the final frontend build are recorded separately by the release coordinator.

Source: `/private/tmp/tpp-bill-intake-20261008`, recovered byte-for-byte from verified live `72759ea` and imported as local baseline `5482847`. The final backend fingerprint covers **874** Python files under `apps` and `config`, plus `requirements.in` and `requirements.txt`, sorted by relative path. SHA-256 before and after the passing full run was identical:

`a7ff9ec0a1af50cd7e7a358ceefb27bad3d89bf4447303b100ef0163f24aa1c4`

The private full-run log is `.runtime/bill-full-backend-regression-final.log`; fingerprint receipts are `.runtime/bill-backend-source-before.json` and `.runtime/bill-backend-source-after.json`. Tests used `DB_NAME=tpp_bill_full_20261008`, creating and destroying the separate `test_tpp_bill_full_20261008` database. They did not use the live database or mutate production records.

## Verified behavior

- Watchman arrival takes 1–6 validated bill images, stores normalized readable private JPEG pages and a server arrival timestamp, and leaves stock unchanged. One invalid page rejects the entire arrival.
- Arrival audit and eligible-user IN_APP notifications persist inside the same transaction. Same-token retries and concurrent uploads create one arrival, one audit event and one notification per eligible user. Other users and external delivery channels receive none.
- Watchman sees only their own current-day arrivals at assigned gates; inventory metadata, receipt details and other duplicate bill identifiers are redacted. Current role restrictions are applied again to cached idempotent responses, including ordinary-JWT owner-to-Watchman preview.
- Unified BULK/ROLL/PACKAGING GRN, PO receipt and trading receipt use the existing ERP stock services. Failed or cross-plant posting rolls back both stock and bill linkage. Bill-linked posting requires an inventory-entered invoice/bill reference.
- Bills stay PENDING_GRN or PARTIAL_GRN until inventory explicitly confirms all lines received. Posting/linking supports several references; completion requires at least one posted receipt and adds no stock. NON_STOCK and other explained VOID resolutions preserve arrival images and permanent audit evidence.
- Concurrent distinct actors/tokens using the same invoice cannot double stock. A first-attempt collision with an existing legacy ERP posting token is refused; existing receipt matching must use the explicit link action. Idempotency-Key must match the body posting token or be omitted.
- One physical receipt cannot be represented twice by a PO header and its BULK/ROLL/PACKAGING child rows, either across bills or in the same linking request. Rejected PO header quality is inherited by child receipt aliases. Consumed/split rolls retain their original receipt quantity for matching.
- Mixed-unit PO receipts expose separate quantities_by_uom and a null combined quantity; unlike units are never added into a false total. Invoice/reference candidate search and original receipt quantities were exercised.
- Arrival identity fields, image pages, receipt references and audit history have PostgreSQL update/delete guards. Authenticated private image responses use private/no-store and nosniff; list/audit/notification payloads contain no image bytes.
- Legacy inward history and master recovery remain available, watchman manual INWARD goods posting is refused, outward logging is preserved, public visitor QR entry remains immediate INSIDE and watchman visitors remain exit-only.

## Regression evidence

All **46 gate tests** passed in 16.577 seconds in `.runtime/bill-all-gate-tests.log`. Users/analytics and performance regression checks passed separately; the final full run includes those tests and their added permission-budget cases.

The first full run had two production board query-budget failures caused by a roleless GUEST lookup. The lookup was removed without relaxing either assertion. The passing full run records jobs-board query counts **[7, 7, 7]** and planner-board counts **[8, 8, 8]**, constant across page sizes and without read-time writes.

`manage.py check`, `manage.py makemigrations --check --dry-run` and `git diff --check` passed. New schema migrations are `gate.0003_inward_bill_intake` and `users.0013` (notification plant/deep-link/deduplication fields). Local migration and QA API startup are managed separately by root.

The release review also identified additive-schema rollback compatibility: the previous application image omits the new Notification.deep_link column on INSERT. Its model and fresh migration now retain `default="", db_default=""`, and a raw legacy-column INSERT regression passes. The final 1,247-test run includes this fix and test; the source fingerprint above supersedes the earlier 1,246-test result.

## GRN frontend integrity review

The authorized code review fixed a mounted-form retry gap: an uncertain GRN retains its original bill, posting kind, deep-cloned body and token when the query changes or disappears. The original bill retry link remains visible; an empty, invalid, unavailable or closed bill context cannot silently post unlinked stock. A successful response invalidates its actual linked bill. Class/source changes are refused while a request remains frozen, and confirmations use the returned class/UOM. Unsupported Excel posting is disabled/refused inside bill context; ordinary Excel posting remains available without bill context.

The executable real-hook regression `frontend_v2/scripts/test-bill-grn-context.mjs` passed under bundled Node LTS, covering changed/removed/invalid/closed context, identical frozen retry, original retry link, cross-kind isolation and ordinary posting. TypeScript `tsc --noEmit --incremental false` passed (private log `.runtime/bill-grn-typecheck.log`). These do not replace browser, release-build or physical-camera acceptance.

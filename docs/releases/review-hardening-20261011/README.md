# Release: review hardening (stock integrity, permissions, order guards, wastage reasons)

- **Base:** the live AWS release `c8833f41e6f0` (`codex/documents-jobwork-20261010`).
- **Branch:** `codex/review-hardening-20261011`.
- **Scope:** fixes from the 11 Oct 2026 full-stack review, plus the operator request to record why wastage was high on the machine terminal. Credit and finance (credit limits, invoices, receivables) are out of scope for this release.

## What changes for users

| Area | Change |
|---|---|
| Inventory rights | Changing stock now needs the right capability. GRNs need inventory or purchase receipt rights. Roll moves, quarantine and splits need inventory rights. Stock-form conversion, inter-plant challans and ink-floor posting need inventory or production rights. Locations need factory administration. Resolving inventory alerts needs inventory view (store, planning, work centers). Reading stock, rolls and locations is unchanged for every signed-in user. |
| Rolls | Roll rows can no longer be created, edited or deleted directly; weight, status and location change only through receipts, production, dispatch, job work, moves and adjustments. A move needs an available, unreserved roll, a real same-plant location and a manual reason; cross-plant moves use an inter-plant challan. Quarantine needs a reason and keeps a history. |
| Retired endpoints (410) | `inventory/rolls/reserve`, `rolls/release`, `rolls/consume` and `inventory/bulk/inward`. No screen used them. Reservations and consumption run on the work-center and machine terminals, and bulk receipts run through the GRN. |
| Splits | A split must account for every kilogram of the parent roll. Each child gets a movement record, so the roll stock card stays correct. |
| Stock adjustments | Someone other than the person who drafted an adjustment must post it (owners and administrators may post their own). Every line writes the stock ledger, so the stock card ties to on-hand stock. Lines must be in the adjustment's plant, in the item's stock unit, and not in a virtual location. Consumed or dispatched rolls cannot be revived. A void is refused if the roll has changed since posting. |
| Bulk transfers | Both legs of a location transfer are recorded as TRANSFER, so internal moves no longer appear in GRN history, bill matching or consumption. Historical transfer legs are retyped by migration `inventory.0057`. Rows already linked to a bill or a GRN correction are left unchanged. |
| Sales orders | Only a draft order can be edited or deleted; confirmed orders change through Cancel. Quotation evidence on an order comes only from the quote-to-order conversion and cannot be supplied by a client. The Commercial and Finance approval gates of a quotation need two different approvers, unless the approver is an owner. |
| Machine terminal | Trim and scrap now take a **wastage reason** (from the scrap reason list) and a **note**. Both are required when the wastage share of an output log reaches the company limit (default 5 %; Company profile → Production). The reason is stored on the scrap logs, so scrap reports show real causes. |
| Users | Administrators manage staff, but only an owner can grant owner rights or change an owner account. The last active owner cannot be removed. Delete now deactivates the account: its name stays on history and its sessions are revoked. |
| Role matrix | Unticking a permission and saving now really removes it, including built-in defaults. Restore defaults clears the removals, and a per-user grant still applies. |
| Sign-in | After 10 failed attempts in 15 minutes an account is locked for 15 minutes, whether the email or the username was typed. The lock is audited. |
| Gate | Owners can replace a plant's visitor QR from Gate setup (with a reason, audited); the old printed QR stops working. Each gate accepts at most `GATE_PUBLIC_HOURLY_CAP` (120) self-registrations per hour. |
| Reliability | A request that changes data and ends in an error now commits nothing; before, the writes made before the failure were kept. Permission denials are now actually recorded in the system audit; before, they were rolled back with the request. |

## Deploy checklist (AWS Lightsail, compose project `aws`)
1. Hash-compare the live release dir with `c8833f41e6f0`. Never rsync the whole local tree.
2. Build: extract `git archive` of the release commit into a new `/opt/tpp-erp/releases/<commit12>`, tag the running images as `tpp-erp-{backend,frontend}:rollback-review-<commit12>`, and build `tpp-erp-{backend,frontend}:<commit12>` with `APP_BUILD_SHA`. No running service changes.
3. Take a managed backup (`BackupService.run_database_backup`) and prove it with a temporary restore drill. Nothing is restored over live data.
4. `check --deploy` with the new image, and refuse any migration plan other than the two below.
5. Update `/opt/tpp-erp/secrets/app.env`:
   - `JWT_COOKIE_SAMESITE=Lax`, `JWT_COOKIE_DOMAIN` empty and `JWT_LEGACY_COOKIE_DOMAINS=.totalpolyprint.com`. Login cookies stop being sent to every `*.totalpolyprint.com` site. The old parent-domain cookies are expired on the next sign-in, refresh or logout, and the new host-only cookie wins meanwhile, so nobody is signed out.
   - `CELERY_TIMEZONE=Asia/Kolkata` (this is also the default). The beat schedules in `config/settings.py` are now in IST. The nightly inventory snapshot moves to 23:45 IST and MRP to 02:00 IST. Document, gate-pass and job-work reminders keep their 09:00–09:20 IST times.
   - Optional: `CACHE_REDIS_URL`. It defaults to `REDIS_URL` on database 1, and the cache keeps working (with relaxed rate limits) if Redis is down.
   - Optional: `GATE_PUBLIC_HOURLY_CAP` (default 120).
6. Back up `app.env` before editing it; a rollback restores it. There are no new dependencies.
7. `migrate`. The migrations are:
   - `users.0014`: `Role.revoked_permissions` and `CompanyProfile.waste_reason_threshold_pct`, both with database defaults, so the previous image can still insert rows.
   - `inventory.0057`: retypes historical transfer legs. It is data-only, and its reverse is a no-op.
8. Point the `app` symlink at the new dir, tag the new images `production` and `up -d` backend, worker, beat and frontend. Celery beat resets its schedule once, because the timezone changed. Any failed check rolls back the source, images and `app.env`.
9. Smoke test:
   - As Store: Smart GRN, a roll move, and an adjustment drafted by one store user and posted by another.
   - As Sales: a confirmed order cannot be edited or deleted.
   - As Operator: log an output with high trim/scrap; the reason and note are requested.
   - As Owner: Gate setup → Replace visitor QR (then print the new poster), and Role matrix untick → user loses the right.
   - `curl https://erp.totalpolyprint.com/api/health/ready/`

**Rollback:** re-point the symlink and start the rollback images. The schema is additive with database defaults. Retyped transfer legs simply stay out of GRN history under the old image.

## Verification (local, 11 Oct 2026)
- **Backend:** the full suite passes on a fresh database. New regression tests:
  - `apps/inventory/tests_review_hardening.py`
  - `apps/sales/tests/test_order_guards.py`
  - `apps/users/tests_review_hardening.py`
  - `apps/gate/tests_review_hardening.py`
  - `config/tests/test_api_transactions.py`
  - the wastage and machine-scope tests in `test_machine_terminal_endpoints.py`
- **Frontend:** `npm run build` (theme tokens, version labels, typegen, `tsc`, `next build`), ESLint on the changed files, help coverage (186 pages, English and Hindi) and nav-route validation all pass.
- **Migrations:** applied cleanly on a copy of the local development database (last migrated 10 Aug), and on a fresh database.
- **Business flows:** `run_tagged_acceptance` passes 31/31 scenarios on a freshly seeded `test_` database. Those scenarios cover GRN, rolls, packaging, dispatch and challans, the WIP route, job work, the planner and the UI smoke checks.
- **Browser smoke** on the local production build, as the local test admin:
  - Machine terminal: 18.2 % wastage asks for a reason and note.
  - Gate setup: Replace visitor QR changes the link and confirms.
  - Company profile → Production: the limit saves; 150 % is refused.
  - Stock adjustment: the UOM field is read-only.
  - The role matrix loads.
- **Not run:** the Playwright UI suite. Its browser binary is not installed on the review machine; install it with `npx playwright install chromium`, then run `npm run e2e:ui:green`.

## Test tooling fixed in this release
These scripts have no effect on production behaviour; the fixes let the release gate run from an empty database.
- `bootstrap_report_smoke` no longer tries to write the private gate register to media files. The watchman release made it database-only, and the command crashed on it.
- The `JOBWORK_PLANNED_STEP` acceptance check uses the job-work statuses introduced on 10 Oct (`PARTLY_RETURNED` / `RETURNED`).
- `seed_ui_e2e.py` creates an active LDPE quality code, and `seed_ui_e2e_sales.py` never falls back to its own quotation approver as the submitter.

## Not in this release
- **Customer returns after dispatch** (return-to-stock). This is a separate feature: it needs a returns workflow and quality disposition, plus fulfilment recalculation across dispatch and sales reports.
- **Moving bill/document images out of Postgres to object storage.** This is a data migration with a backup redesign. Disk usage is already monitored by the document storage task.
- **Public GitHub repository.** Make `dev2495/total-blueprint-erp` private; that is a GitHub setting, not code.

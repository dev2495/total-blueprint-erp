# Queue performance and reliable planner release

## Invariants

- Planner and work-center display reads project the current BOM without modifying orders, requirements or reservations. Preview requirement identities remain stable when a later explicit write creates the requirement.
- Persisted requirement calculations lock the production job before its requirements. Reservation reconciliation remains an explicit write operation.
- Selected-line actions require matching order kind, order ID, sales-line ID and revision. Query cancellation is forwarded to HTTP clients; obsolete selections cannot authorize another line.
- A plan and a release remain two separate business transitions. Each gets its own durable operation UUID. An identical retry returns the original receipt; token reuse with another request and stale revisions are rejected.
- After a confirmed save, remove the exact queue row and await the current queue refresh. A failed refresh must say that the save completed. Do not encourage resubmitting the order.
- Both notification APIs used by existing screens have mounted renderers. Save/recovery feedback has its own visible viewport, and a failed post-save refresh also leaves a persistent queue message. Planner dialogs render in a body portal above navigation and outside page clipping.
- Pending operations persist in the signed-in user's browser session. Resume reuses the original payload and identities. It never silently starts another plan. Storage restrictions or closing the browser session can remove client recovery information; server receipts remain durable.
- Cursor pagination uses stable order and sibling-line positions. Queue counts describe the loaded page, not the whole database. Complex computed filters may require scanning multiple cursor pages.

## Performance controls

Inventory matching joins source provenance before scanning candidates and calculates names after signature matching. It streams candidates and preserves eligibility rules and the existing 24-option limit. Sales lifecycle and material availability aggregates are batched. The planning queue returns a compact summary; detail loads independently.

Every response carries `X-Request-ID`, `X-App-Build` and `Server-Timing`. Queue read logs record route, status, wall duration, SQL time and query count without SQL text, parameters or credentials. Queue GET/HEAD requests have PostgreSQL statement and lock budgets (defaults: 4,000 ms and 500 ms; `QUEUE_SQL_TIMEOUT_MS` and `QUEUE_LOCK_TIMEOUT_MS`). These are per-statement/lock budgets, not a total CPU or request deadline. The middleware restores previous connection settings before reuse.

Known read-budget failures return `READ_TIMEOUT` or `READ_BUSY` with a recoverable 503. Clients do not automatically multiply those failures or 12-second HTTP timeouts. Cancellation does not imply that an already executing server statement stops; the database budgets provide a separate bound.

## Acceptance evidence

The September 30 candidate passed 1,062 backend tests, the production frontend build, lint, migration drift and read-only SQL guards. Targeted checks include concurrent WCM readers and a writer, constant query growth for 100 materials, eligibility after 250 rejected rolls, stable pagination across 230 siblings and intervening releases, duplicate receipts, stale revisions, rollback of failed mutations, and browser recovery after losing either POST response.

The existing dependency audit identified 10 advisories against PyJWT 2.13.0. The lock now pins 2.15.1 with regenerated hashes; other locked versions remain unchanged. Backend and production frontend dependency audits pass, and all 1,062 backend tests passed again with the updated JWT package. The upstream changes are documented in the [PyJWT changelog](https://pyjwt.readthedocs.io/en/stable/changelog.html).

On an isolated production-data copy, 50 consecutive browser plan/releases completed without reloading. Mobile queue fields and planner overlays were checked at 390 pixels, including dialog focus and Escape. These tests do not certify all production roles, physical devices or sustained peak-load latency.

## AWS release and rollback

Build an immutable archive from the verified deployed parent revision. The current Git remote `main` must not be substituted for the deployed release without checking ancestry. Preserve the previous application directory, backend image and frontend image before changing production tags. Build both candidate images with `APP_BUILD_SHA` set to the candidate commit.

Before switching services, run a managed database backup and restore drill. Confirm that the only pending migration is additive production `0073_planner_operation_receipts`, then apply it with the candidate backend. It creates a receipts table and does not repair or rewrite business data.

Recreate backend, worker, beat and frontend using the preserved compose configuration. Verify readiness/liveness, image revisions, worker responses, current-commit marker, frontend assets and authenticated queue/WCM reads. Run bounded SQL-guarded read-only profiles against the deployed database.

For rollback, restore the preserved backend/frontend production image tags and application source directory, recreate those four services, and verify health and workers. Leave the additive receipts table in place. Do not reverse the migration or restore the production database as a routine application rollback; that would risk losing later business activity.

## Continuing qualification

Use measured production traffic to qualify queue p95 <= 1.5 seconds, selected detail p95 <= 1 second, and release acknowledgement p95 <= 2 seconds. A short successful sample is not a sustained SLA. Review query-count regressions and slow route logs with the deployed build identity. Run an agreed 60-minute peak-period/2x-load soak in an isolated environment with representative concurrent roles, plus explicit plant/device workflows. Physical printing and scanning and off-host failover remain separate acceptance exercises.

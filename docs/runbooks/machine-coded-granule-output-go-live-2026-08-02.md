# Machine Output Completion Incident — Production Go-Live Report

Date: 2026-08-02  
Runtime commit: `e233906` (`Fix coded granule machine output completion`)  
Branch: `codex/planner-sales-latest-20260629`

## Incident

Two extrusion machine terminals returned HTTP 400 with
`MACHINE_LOG_OUTPUT_FAILED` while operators attempted to record roll output:

- machine `57422a47-459d-4139-8aa8-6ada61797de8`, job `SO-2026-0330-0ba1-B01-1`
- machine `97d6d3a6-0dbf-4bdd-8006-1abaac43466f`, job `SO-2026-0270-1191-B01-1`

The production traceback showed that machine completion reached the guarded
inventory consumption path without the internal grade/code already selected by
WCM. HDPE was the first coded family to fail, so the complete output transaction
rolled back.

## Root cause

WCM correctly saved the exact grade/code allocations in
`ProductionJob.current_step_material_confirmations` and moved the corresponding
coded stock to the job input location. The machine execution service consumed
the material family totals but did not forward `granule_code_id` to the stock
ledger. The inventory guard correctly rejected that uncoded consumption.

This was a server-side hand-off defect between WCM allocation and machine
execution. It was not an operator, recipe, stock, browser, or machine setup
problem.

## Fix

- Reuse the exact WCM-confirmed code split during every machine output event.
- Allocate cumulative consumption deterministically across the saved code split.
- Reconcile final consumption and returns against those same exact codes.
- Preserve the existing inventory rule that coded granule families cannot be
  consumed without a code.
- Return an actionable validation response for any future master-data defect
  instead of masking it as a generic machine failure.
- No schema, recipe, BOM, machine UI, or operator workflow change.

Repeated partial output is idempotent with respect to the cumulative material
target: several partial submissions produce the same per-code total as one full
submission at the inventory ledger's four-decimal precision.

## Regression coverage

The release adds production-shaped tests for:

- a WCM-issued granule family split across two internal codes;
- two successive machine output events;
- normal job close;
- issue allowance and exact-code return reconciliation;
- absence of uncoded granule transactions;
- restoration of each exact code's stock balance.

Verification results:

- focused production tests: **23 passed**;
- complete backend suite: **971 passed**;
- Django system check: **passed**;
- migration drift check: **no changes detected**;
- candidate AWS image focused tests: **23 passed**;
- candidate AWS image Django check: **passed**;
- database migrations: **current; none pending**.

## Production release evidence

- Pre-deploy database backup:
  `/opt/tpp-erp/backups/daily/tpp-erp-db-20260802-135106+0530.sql.gz`
- Backup gzip integrity and SHA-256 sidecar: **passed**.
- Backend, worker, and beat recreated from the tested candidate image.
- Backend and frontend containers: **healthy**.
- Worker: connected to Redis and reported **ready**.
- Queue health task: `healthy: True`, one active worker.
- Public liveness endpoint: HTTP 200.
- Public readiness endpoint: HTTP 200.
- Both affected machine pages: HTTP 200.
- Post-deploy backend/worker/beat logs: no traceback or error.
- Running-container source hashes match the tested release source.

## Live affected-job audit

Both jobs remain `EXECUTING` / `RUNNING`. Their failed requests created:

- zero production execution logs;
- zero material consumption logs;
- zero produced quantity.

The original transaction boundary therefore protected production and stock data;
operators will not duplicate an earlier saved output when they retry.

For every granule requirement on both jobs, the release resolved a complete
target split from the existing WCM confirmation. This includes:

- HDPE code `f5078a20-f9bd-4939-ac70-8a87becc26eb` on both jobs;
- both saved MASTER-BATCH codes;
- all LDPE, LLDPE, metallocene, and master-batch requirements;
- exact per-family split totals equal to the required material quantity.

The audit was read-only and did not complete or alter either live job.

## Operator hand-off

1. Refresh the machine page once (`Ctrl+Shift+R`).
2. Enter the same roll rows and waste values again.
3. Submit output and then complete the order normally.

Do not recreate the order, reissue material, change the recipe, or select the
granule codes again. WCM's saved allocation is now used automatically.

## Rollback

If an unrelated regression is discovered, restore application source to
`ca68544`, rebuild the backend image, and recreate backend/worker/beat. The
pre-deploy database backup above is retained; this release introduced no schema
change.

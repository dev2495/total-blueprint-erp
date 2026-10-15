# Release: floor logic contracts + preventive maintenance (15 Oct 2026)

- **Base:** live `28aa4de42a5f` (UI polish + dialog scroll hotfix, 14 Oct 2026).
- **Branch:** `codex/floor-logic-20261015`.
- **Why:** the 15 Oct floor review (SO-2026-0608, Rajtilak 65,000 silver BOPP bags) found seven symptoms behind three missing contracts; the client also asked for preventive maintenance on the phone, per-machine and per-location QR codes, and a machine setting for running several orders at once.

## Floor logic (what changed and why)

| # | Symptom | Cause | Now |
|---|---|---|---|
| 1 | "65000 kg required", "Output now 65000.005 kg" | A pieces figure went through a kg formatter; job-level PCS fields were used as kg fallbacks | Terminal figures are unit-safe: kg from kg fields only; piece jobs show pieces and kg; the output seed is capped by the step target |
| 2 | BOPP tape missing from the machine issue area | Add-ons without a template step mapping never got a requirement row for any step | Add-ons default to the last route step (packaging stays with the packing flow); they appear in the issue area in their own unit (meters) |
| 3 | Tape plan 18,200 m; "per 10 mm" weight in the master | The master had no basis field; the coefficient was read as per 1 mm | `addon_weight_basis_mm` (1 or 10) on the add-on master, used by the resolver; live example on the master page; master edits re-resolve open lines; released lines get "Recalculate from masters" on the WCM terminal (refused once output exists) |
| 4 | 300 + 700 kg rolls could not both be allocated | Roll readiness and allocation were a count; roll→bulk NONE was hard-set to exactly one roll | Roll contract per step: MASS (any number of rolls until the step mass is covered, capped at target + tolerance) or COUNT (combine lanes, laminate layers, split/modify). WCM shows "N rolls · X of Y kg" |
| 5 | Batch progress lagged the job | Simple log path never synced the batch | Both log paths sync batch progress |
| 6 | Step target unexplained | Single number | "Target comes from" line: film + ink + chemicals + add-ons per piece × pieces; per-unit basis on order BOM rows |
| 7 | Pause kept time only for costing | No downtime record on pause | Pause writes a `DowntimeLog` (bucket + governed reason code + note, `source=PAUSE`); resume and completion close it; both terminals use one pause dialog. OEE and maintenance read one timeline |

Also: **add-on shortage switch** `ADDON_SHORTAGE_BLOCKS` (env, default off). Add-on rows are always shown, issued and consumed at their step; a shortage is flagged in amber on the WCM release bar ("Add-on stock short (not blocking)") and blocks release or start only when the switch is on. Turn it on once tape and zipper stock is received into the ERP at each plant; until then the floor keeps running.

**Calmer screens**: the header bell's gate-bill summary polled every 5 s on every page for bill reviewers, the inventory bill inbox polled again under its own key, and the machine terminal polled every 8 s and 5 s. Now 30 s, 30 s, 15 s (bill queues) and 15 s (terminal); every action still refreshes what it changed at once, and windows refresh on focus.

**Machine concurrency policy** (`Machine.concurrency_policy`: AUTO = bulk→roll steps may run several orders, others one at a time; ALLOW; DENY), enforced at start with a clear refusal naming the running job; set on the machine master.

## Preventive maintenance (new module `apps.maintenance`)
- Schedules per machine (daily / weekly / monthly / every N running hours), fixed-calendar or after-last-service due rules, checklist items (OK/Issue or reading with range), operator check vs technician service, critical = verified.
- Jobs are generated every morning at 05:30 (Celery beat) and on demand; a late completion never moves a fixed-calendar date; planned and actual dates are separate; three outcomes (completed / issue found / unable with reason); issue found raises a fault; verification by supervisor; every edit logged.
- Faults: report from any screen; a stopping fault pauses the running step as a breakdown and marks the machine DOWN; assign creates the repair job; resolve returns the machine to ACTIVE.
- Spares are a note on the job (item, qty, cost); no stock.
- Board (due today, overdue, open faults, machines awaiting repair, awaiting verification), reports (compliance, breakdowns & downtime from the production downtime log, recurring faults, spares & time, technician workload), machine history timeline.
- Roles `MAINTENANCE_TECH` and `MAINTENANCE_SUPERVISOR` (data migration creates them); permissions `maintenance.view/log/work/manage`; WCM/operator get view+log, plant manager gets manage.
- Overdue reminder at 08:00 via the notification service (`maintenance.overdue`), fault reports via `maintenance.fault_reported`.

## QR and phone scan
- Printable QR posters for every machine and every stock location (`/maintenance/qr`, plus a QR button on the machine card and a "QR code" action on the locations master).
- Scan icon in the header for every role (desktop and phone), using the existing gate scanner.
- `/m/<machine code>`: role-aware machine card. Operator: today's checks, report fault, terminal link. Technician: open jobs, schedules, history. Supervisor / work-centre manager: running order with a quick output log. Owner / plant manager: queue, 30-day run hours, downtime, breakdowns. Maintenance supervisor: the machine's board.
- `/loc/<location code>`: what the system says is at the location (rolls by material, bulk lines, packed units, totals); store users count against it and post differences as a stock adjustment (count correction) through the normal posting rules; owners see the totals.

## Security and data checks
- Maintenance, scan and QR endpoints keep the global role guard (strict RBAC in production); the watchman is refused everywhere; the location card needs `inventory.view`, the machine card `production.view`, QR images `factory.view`, maintenance panels `maintenance.view`.
- Photos are served only through the logged-in API (`/api/maintenance/attachments/<id>/file/`), stored on the persistent media volume, 8 MB limit, images and PDF only.
- The phone count only offers materials a stock adjustment can post (bulk categories, one quality code at the location); coded granules held under several codes go to the physical count. A failed post removes its draft.
- Resume honours the machine concurrency policy, same as start.

## Guard rails
- Unit tests: `apps/production/tests/test_floor_logic_contracts.py` (19: resume guard and add-on shortage switch added; roll contract, add-on basis, add-on issue step, pause/resume downtime, concurrency policy, recalc guard), `apps/maintenance/tests.py` (11: fixed-calendar vs after-last-service, unable/issue outcomes, fault pauses job, strict-RBAC per role).
- E2E: `tests/e2e/gate/maintenance.spec.ts` (schedule → due job → record → fault → QR → machine and location scan cards; header scan button), plus the existing sweeps.
- Migrations (all additive): `factory.0029`, `materials.0052`, `production.0076`, `maintenance.0001`, `maintenance.0002` (roles).

## Deploy
Build and activate with `.runtime/release-floor-logic/{build,activate}-floor-release.sh` (parent `28aa4de42a5f`). Migrate runs inside activate; no env change; beat picks up the two new schedules on restart.

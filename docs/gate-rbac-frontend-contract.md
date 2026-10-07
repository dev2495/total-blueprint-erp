# Gate role, reports and audit frontend contract

## Role and landing

`WATCHMAN` is the canonical role and display label is `Watchman`. Login entitlements
land at `/gate`. The closed permission list is `gate.log`,
`page.gate.watchman.view`, `users.self_manage`, `page.profile.view`. Watchman has no
ERP master, sales, inventory, report, analytics, settings or history access.
Use `/api/gate/masters/` for sanitized pickers, never ERP master APIs.

Visitor QR self-submission records entry immediately (`status: "INSIDE"` with
`entry_at`); it is not an admission request. Watchman visitor actions are exit
only via `POST /api/gate/visitors/{visitor_id}/check-out/`. Do not show walk-in,
admit/check-in or cancel actions to Watchman. Those POST routes return 403 for
actual/effective Watchman, including any legacy `PENDING` registrations. Admin/owner
history and correction access remain separate. Report `visitor_entries` counts
the QR submission's recorded entry immediately, without a second confirmation.

`entitlements.context.gate_plants` and user `gate_plant_ids` are UUID lists. An
empty assignment must display an assignment-needed state and allow no logging.
User admin create/edit accepts `gate_plant_ids: [plant_uuid, ...]`. Assignments can
also be saved with `POST /api/users/users/{user_id}/assign-gate-plants/` and JSON
`{"gate_plant_ids": [plant_uuid, ...]}`. Administrator/owner authorization is
required; watchman cannot assign themselves. Factory `/api/factory/plants/` is
available to existing user-management actors for selecting assignments.

## Admin/owner and report permission

Actual `ADMIN`, `SUPER_ADMIN`, `OWNER`, `is_owner`, or `is_superuser` accounts
receive full Gate access by default: registration/setup, all plants, visitor
history/details/photos, corrections/reconciliation, QR posters, intelligence,
audit, report configuration/generation, and private archives. No per-user owner
flag or GateAssignment is needed for an actual Admin. The shared backend policy
is `PermissionService.is_gate_master(user)`; `entitlements.gate_master` exposes
the same decision, and the user payload includes a read-only `is_superuser`.
Actual/effective `WATCHMAN` always overrides every master role, flag, superuser
status, and wildcard. Owner preview on an actual Admin retains full Gate rights;
Watchman preview restricts that account to assigned-gate operations. A preview
alone never upgrades a non-master department account. A non-master `*` override
also does not grant master Gate access. Master capabilities are `gate.log`,
`gate.reports`, `gate.view`, `gate.reconcile`, `gate.audit`,
`gate.private`. History, reconciliation, audit and private-image capabilities
are not assignable as user permission overrides.

The separately assignable reports pack permission is **`gate.reports`**. Show the
report tab when actual master or explicit `gate.reports` exists; do not infer it from
`analytics.view` or `*`. The report page route is **`/analytics/reports/gate`**.
The backend report catalog returns `id: "gate"`, `permission: "gate.reports"`.
Delegated readers receive goods register rows and aggregate visitor counts;
they never receive names, mobile numbers, government IDs, or photos of visitors.

`GET /api/analytics/reports/gate/` returns the common report shape:
`tab`, `summary`, `rows`, `series`, `breakdowns`, `coverage`, `warnings`,
`generated_at`. Filters: `date_from`, `date_to` (`YYYY-MM-DD`), `plant` (UUID).
`series` contains one row per selected local calendar day, including quiet days:
`{"date": "2026-10-07", "inward": 2, "outward": 1, "total": 3}`. All three
measures are counts of physical goods movement records, not product lines or
quantity. Use trend measures `inward`, `outward`, `total` with number/count
formatting. Dates are grouped in the gate business timezone (Asia/Kolkata), and
the selected plant/date scope is identical to the summary. Product quantities
remain separate in `summary.quantity_by_uom` and are never added across KG/PCS.
`GET /api/analytics/reports/gate/export-pdf/` downloads the same filtered report.
Use `gate` APIs in `docs/gate-api-contract.md` for admin/owner history/reconciliation.

## Daily report pack

The exact distribution profile code is **`gate_register_daily`** and the label
is **Gate Register Daily**. It is a new option beside existing daily packs.
Default recipients remain `OWNER` only; access rights do not rewrite the existing
profile or notification recipients. Admin and owner can toggle its active status using
the existing distribution form (`report_code`, `active`) and send/preview it
using the existing archive actions. Do not add a `GATE_REGISTER` code.

Existing master endpoints remain:

- `GET /api/analytics/report-distributions/` → `profiles[]` (gate profile included for every actual master).
- `PUT /api/analytics/report-distributions/` with `{"profiles": [{"report_code": "gate_register_daily", "active": true}]}`.
- `POST /api/analytics/report-distributions/gate_register_daily/send/` with optional `report_date` (`YYYY-MM-DD`).
- `GET /api/analytics/report-runs/` → `runs[]`.
- `GET /api/analytics/report-runs/{run_id}/preview-pdf/`, `download-pdf/`, `download-detail/`.

Gate PDF and detail CSV are private database artifacts served through checked
endpoints. Never construct a `/media/` URL for a gate artifact. The daily detail
CSV contains goods register fields only.
Private gate archive bytes are retained as generated evidence; the run response
uses `artifact_retention_days: null` instead of the public media pack's 30-day
retention label.
Delegated `gate.reports` readers can list/read gate archive runs; configuration
and manual generation remain admin/owner-only. The analytics `rows` are flattened
goods lines: `plant`, `logged_at`, `direction`, `invoice_number`, `vehicle_number`,
`party_name`, `product_name`, `quantity`, `uom`, `amount`,
`reconciliation_status`, `reference`, `amount_basis`.

## Intelligence and audit

For actual masters, `/api/analytics/control-tower/` includes `gate` aggregates;
`/api/analytics/dashboard-summary/` includes `snapshots.gate`. Counters include
goods inward/outward, unmatched/discrepancy, pending/inside/overdue visitors,
visitor entries/exits and quantities separated by UOM.
Gate periods and daily report windows use the configured gate business timezone
(Asia/Kolkata), including when the server's Django timezone is UTC.

Admin/owner `/api/analytics/audit-console/` includes `modes.gate` and
`counts.gate_audit`. Unified audit ledger `/api/analytics/audit-ledger/` supports
`stream=gate` with date/range/actor/query filters. Events use IDs `gate:{uuid}`,
label `Gate Register`, and link `/gate/history`.
`GET /api/analytics/audit-ledger/gate:{uuid}/` returns the audit event detail.
Audit before/after snapshots exclude raw government ID, image data and full
visitor mobile; they remain append-only. Non-master departments and report-only
delegates cannot view gate events through existing audit routes.

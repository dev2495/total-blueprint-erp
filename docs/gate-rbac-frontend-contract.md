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
actual/effective Watchman, including any legacy `PENDING` registrations. Owner
history and correction access remain separate. Report `visitor_entries` counts
the QR submission's recorded entry immediately, without a second confirmation.

`entitlements.context.gate_plants` and user `gate_plant_ids` are UUID lists. An
empty assignment must display an assignment-needed state and allow no logging.
User admin create/edit accepts `gate_plant_ids: [plant_uuid, ...]`. Assignments can
also be saved with `POST /api/users/users/{user_id}/assign-gate-plants/` and JSON
`{"gate_plant_ids": [plant_uuid, ...]}`. Administrator/owner authorization is
required; watchman cannot assign themselves. Factory `/api/factory/plants/` is
available to existing user-management actors for selecting assignments.

## Owner and report permission

Only an actual owner (`is_owner` or canonical `OWNER`) can see gate history,
visitor personal details, corrections/reconciliation, audit stream and historical
selfies. An `ADMIN` wildcard or owner role preview does not grant this access.
Canonical owner capabilities: `gate.view`, `gate.reconcile`, `gate.audit`,
`gate.private`. They are not assignable as user permission overrides.

The separately assignable reports pack permission is **`gate.reports`**. Show the
report tab when owner or explicit `gate.reports` exists; do not infer it from
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
Use `gate` APIs in `docs/gate-api-contract.md` for owner history/reconciliation.

## Daily report pack

The exact distribution profile code is **`gate_register_daily`** and the label
is **Gate Register Daily**. It is a new option beside existing daily packs.
Default recipients are `OWNER` only. Owner can toggle its active status using
the existing distribution form (`report_code`, `active`) and send/preview it
using the existing archive actions. Do not add a `GATE_REGISTER` code.

Existing owner endpoints remain:

- `GET /api/analytics/report-distributions/` → `profiles[]` (gate profile hidden from non-owner admin).
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
and manual generation remain owner-only. The analytics `rows` are flattened
goods lines: `plant`, `logged_at`, `direction`, `invoice_number`, `vehicle_number`,
`party_name`, `product_name`, `quantity`, `uom`, `amount`,
`reconciliation_status`, `reference`, `amount_basis`.

## Intelligence and audit

For actual owners, `/api/analytics/control-tower/` includes `gate` aggregates;
`/api/analytics/dashboard-summary/` includes `snapshots.gate`. Counters include
goods inward/outward, unmatched/discrepancy, pending/inside/overdue visitors,
visitor entries/exits and quantities separated by UOM.
Gate periods and daily report windows use the configured gate business timezone
(Asia/Kolkata), including when the server's Django timezone is UTC.

Owner `/api/analytics/audit-console/` includes `modes.gate` and
`counts.gate_audit`. Unified audit ledger `/api/analytics/audit-ledger/` supports
`stream=gate` with date/range/actor/query filters. Events use IDs `gate:{uuid}`,
label `Gate Register`, and link `/gate/history`.
`GET /api/analytics/audit-ledger/gate:{uuid}/` returns the audit event detail.
Audit before/after snapshots exclude raw government ID, image data and full
visitor mobile; they remain append-only. Non-owner admin cannot view gate
events or a gate report run through existing audit routes.

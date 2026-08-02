# Granule code allocation and WCM draft stability go-live

Date: 2026-07-29  
Production: `https://erp.totalpolyprint.com`  
Application release: `fc7fc06e42e6b36f5b97aed25a666ca898f68165`

## Outcome

The two client-reported failures are fixed and deployed:

1. `SLIP-110-C` is visible and allocatable from the WCM material-issue flow.
2. WCM background refreshes no longer replace an operator's in-progress issue quantities or selections.

The release also closes the underlying data-integrity gap so equivalent spellings such as `SLIP-110 C`, `SLIP_110_C`, and `SLIP-110-C` cannot become separate active internal codes again.

## Root cause

`SLIP-110-C` had two master records under the same MASTER BATCH granule family. The exact hyphenated record was active but had zero stock; the space-separated record held 2,000 kg. The old WCM picker only returned positive-stock rows and matched by record ID, so it hid the exact master code the user expected.

Separately, WCM polled queue/stats state every five seconds. Those reads ran reconciliation code and the page rehydrated the selected job from every response, which could replace unsaved allocation rows while the operator was typing or using the picker.

## Permanent controls delivered

### Canonical internal codes

- Codes are normalized with Unicode NFKC, uppercase, and a single canonical dash separator.
- A partial database unique constraint permits only one active canonical code per granule family.
- Single and bulk master-entry APIs reject equivalent spellings atomically, including concurrent requests.
- Historical duplicates are merged by migration; the alias is retained inactive and linked to the survivor for traceability.
- Positive stock is moved to the canonical record with weighted average cost and balanced adjustment transactions.

### Stock and GRN integrity

- A coded granule family cannot be received, transferred, issued, or consumed without an exact active, unmerged internal code.
- Legacy granule families with no configured code remain supported until their code registry is introduced.
- GRN text input resolves through the canonical key instead of creating punctuation/spacing duplicates.
- The GRN UI removes the misleading “No code” choice when the selected family has active codes.

### WCM material allocation

- One availability service now controls picker visibility and server-side allocation validation.
- The picker shows exact code, plant, store, quantity, and one of: allocatable, zero stock, other plant, in transit, inactive location, or merged/inactive.
- Same-plant stock is allocatable; other-plant stock is shown but requires transfer and receipt first.
- Release revalidates and locks the physical stock rows. A stale browser receives HTTP 409 `GRANULE_STOCK_CHANGED` instead of over-issuing.
- WCM queue polling is 15 seconds while active and 30 seconds while hidden, pauses for dirty issue drafts or an open picker, and keeps cached queue data on a temporary request failure.
- Queue/stats GET no longer performs reconciliation writes.

## Production data correction

Before migration:

| Record | Status | Unit/store stock |
|---|---:|---:|
| `SLIP-110 C` | active | Unit 01 / RM: 2,000.0000 kg |
| `SLIP-110-C` | active | Unit 01 / RM: 0.0000 kg |

After migration:

| Record | Status | Link | Unit/store stock |
|---|---:|---|---:|
| `SLIP-110-C` | active | canonical survivor | Unit 01 / RM: 2,000.0000 kg |
| `SLIP-110 C` | inactive | merged into `SLIP-110-C` | Unit 01 / RM: 0.0000 kg |

The migration wrote two `ADJUST` audit rows, `-2,000.0000 kg` on the alias and `+2,000.0000 kg` on the survivor. Their net is exactly `0.0000 kg`. Production has zero duplicate active `(granule family, canonical key)` groups.

The live WCM availability service returns `SLIP-110-C` as `ALLOCATABLE`, `SAME_PLANT`, with 2,000 kg at `total poly print pvt ltd Raw Materials Store`, Unit 01. The inactive alias remains visible only as an explanatory non-allocatable row.

## Verification evidence

### Automated gates

- Backend: 969 tests passed in the combined Django suite.
- Focused code/GRN/WCM suite: 27 tests passed.
- Migration rehearsal: duplicate records, stock, audit rows, and survivor identity verified against PostgreSQL.
- `manage.py check`: zero issues.
- Migration drift: no uncommitted model changes.
- Frontend TypeScript check: passed.
- Frontend optimized Next.js build: passed locally and on the AWS host.
- `git diff --check`: passed.

### Live AWS gates

- Pre-migration compressed SQL backup: `/opt/tpp-erp/backups/daily/tpp-erp-db-20260729-134133+0530.sql.gz`; gzip integrity check passed.
- Migration `materials.0050_canonical_granule_quality_codes`: applied successfully.
- Containers healthy: PostgreSQL, Redis, backend, frontend, worker, and beat.
- Worker connected to Redis and completed the post-restart queue-health task successfully.
- `GET /api/health/live/`: HTTP 200.
- `GET /api/health/ready/`: HTTP 200.
- WCM, Granule Master, and GRN frontend routes: HTTP 200.
- Authenticated live WCM stats call: HTTP 200 with `waiting=45`, `running=15`, `total_active=60`.
- Assignment status/timestamp and production-job state/timestamp were byte-for-byte unchanged before and after that stats call.
- The running frontend bundle contains the new “Unsaved entries protected” UI.

### Deployed source identity

Local checkout, AWS source tree, and running backend container hashes match:

| File | SHA-256 |
|---|---|
| `0050_canonical_granule_quality_codes.py` | `d3ee19001c9c3e0e46827b78a665b5cb731aef9b37f42df44f1dd0c4b6d3feb0` |
| `granule_availability.py` | `7931f6ad99991c890440a99c3e64595a5543b5240a7e67e5841a4274f4dbf082` |
| `views_wc.py` | `c23810c033214822a9cf4279116d8c163b70d86ad39adcde3d9cea991cce3748` |
| WCM page source | `2f45d7d185c7eb0034d4293cef79821668f965a06349a7d4a2a8f4492389a67c` |
| code/source picker | `d09453ed69f05f1d57a199725adb535c78540040be6796ac3fcdcf7e76981ff7` |

## Operator behavior now

For a normal same-plant issue, WCM selects one or more exact internal codes and source stores whose quantities add up to issued kg. A code with no received stock is still listed with a clear reason, rather than silently disappearing. Stock in another plant is visible but cannot be allocated until the inter-plant challan is received. A second user consuming the stock first produces a conflict and forces a fresh choice; the system never guesses or silently over-issues.


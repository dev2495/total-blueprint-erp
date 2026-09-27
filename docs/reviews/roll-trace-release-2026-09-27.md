# Roll trace, allocation and handoff — 27 September 2026

## Operating procedure

### Receive without printed labels

1. Open Inventory → GRN, choose Roll, receiving plant/location and film variant.
2. Enter each physical roll separately: supplier roll number, measured width, thickness, stock form, gross and tare. Use the supplier number already on the roll where available.
3. Save inward once. The confirmation lists each saved ERP roll identity and its trace link.
4. If the roll has no unique supplier marking, write its ERP roll ID on the physical roll. Keep the ERP warehouse/rack location accurate. A location and similar dimensions alone cannot distinguish two identical unmarked rolls.
5. Allocation does not require a printed label. Open the current work-center assignment and step, inspect every required input lane, search by ERP/supplier identity, and compare the physical roll and location before selecting it.

### Labels now or later

- Optional inward checkbox downloads 4 × 2 inch labels after stock is saved.
- The receipt supports all-roll downloads or individual label/reprint. The trace page supports later reprints in 4 × 2 inch or 100 × 50 mm format.
- One saved physical roll produces one PDF page. The QR contains the immutable database UUID; the visible ERP ID and supplier reference help manual identification.
- Print at actual size (100%). Test one label on the intended printer and scanner before printing a batch.
- PDF generation is audited with user, time, size and roll snapshots. It does not prove that a printer physically produced or attached a label.
- If download/printing fails, retry from the receipt or trace. Do not inward the same stock again.

### Pick, scan and allocate

- Candidates come from the current job step and material/lane requirements. Availability, reservations, plant, quarantine, positive weight, material, grade, gauge, width and stock-form constraints are rechecked by the backend.
- QR/ERP/supplier scans require an exact eligible match. Duplicate supplier references require the exact ERP identity. Repeated scans keep the roll selected once.
- Review selections hidden by filters before allocating. A database constraint permits only one ACTIVE reservation per physical roll. Competing requests cannot both reserve it.
- A failed allocation requires refreshing and resolving its reason. Physical eligibility cannot be bypassed by a manual override.
- Remote stock must match requirements. Create-and-dispatch is atomic and retry-safe within the same dialog. Receive the transfer at the destination before local allocation.

## Implementation and audit disposition

| Area | Change | Evidence / limit |
| --- | --- | --- |
| GET side effects | Context, eligible-roll and stock-snapshot reads no longer reconcile business state | SQL-write regression checks; explicit audited maintenance command replaces automatic read repair |
| Allocation race | Job/roll locking, atomic batch/slit allocation and partial unique ACTIVE reservation constraint | Two independent DB connections compete; one succeeds, one conflicts |
| Transfers | Single create-and-dispatch transaction; request key + payload fingerprint | Retry returns the same challan; payload drift rejected; dispatch failure rolls back |
| No-match fallback | Removed remote-stock fallback that returned all raw stock | Missing requirements/no matches produce no candidates |
| Roll stock totals | Removed 2,000-row truncation; actual client pagination; rate lookup is a subquery | 2,005-row regression and query-count bound; full SQL pagination and sustained large-fleet load remain future capacity work |
| Trace / labels | Supplier identity capture, exact/ambiguous resolution, canonical trace links, one PDF page per roll, reprint audit | API, PDF and browser verification; hardware acceptance remains open |
| Error states | PO, transfer, logistics and picker failures are visible; retry available | Browser/API verification; this is not an exhaustive redesign of every route |
| KPI truth | Weight metrics exclude unconvertible non-KG events; PCS requires known unit mass; OEE and on-time completion proxy are explicitly described | No claim of scheduled-shift OEE or full-quantity/POD OTIF |
| KPI actions | Report action links lead to inventory, trace, production, transfer, dispatch and MRP workspaces | Domain navigation is available; a persisted owner/due-date/closure workflow for every KPI is not implemented |
| UI / help | Real pagination, accessible table controls, tablet login layout, four report help gaps, specific roll/transfer instructions | Remaining generic guides have not all been rewritten |

## Release and recovery

Apply migrations 0051–0053 after checking for duplicate active roll reservations. Do not delete conflicts to make migration pass. The September 27 AWS preflight found zero duplicates, closed-job reservations, orphan reserved rolls or legacy assignment candidates.

`repair_roll_readiness --job UUID --roll UUID` previews selected repair work. `--apply` requires an actor UUID and reason and records before/after evidence. Use only for reviewed historical exceptions; never invoke it from a GET endpoint.

Before release: reconcile live source, back up PostgreSQL and source, record image IDs, build immutable images, pause application writers for the schema switch, migrate, restart and verify. Preserve the previous source/images for application rollback. The migrations add fields/tables and a reservation guard; old application rollback can retain those schema additions. Never restore an older database over new customer transactions without a separate recovery decision.

## Handoff gates still requiring evidence

- Client printer, label stock dimensions, scanner and print/scan/attachment acceptance.
- Signed-in live Store / Work Center Manager acceptance on both plants with approved real accounts; local admin UI role simulation does not prove production role access.
- Agreed physical marking procedure for rolls that lack unique supplier numbers.
- Scheduled shifts / downtime policy for true OEE; promised quantity, delivery and POD rules for true OTIF.
- Sustained load, failover and off-host restore exercise; a healthy endpoint is not proof of these.
- Material-only bulk/packaging reservation attribution remains a legacy reporting limitation: reservations lack physical lot/location binding. Do not interpret those row-level figures as a confirmed roll-style physical reservation.

The release improves the existing stack and closes the concrete roll-flow defects above. It is not evidence that every route, hardware device, business KPI policy or disaster recovery scenario is 100% accepted.

## Verification recorded before release

- PostgreSQL backend suite: 1,048 tests, passed; 2 skipped. Migration drift check: no changes detected.
- ESLint and optimized Next.js production build: passed.
- Browser checks: 23 passed in the final report/roll-flow run; its one failure was an outdated Dispatch Bay wording assertion and passed after correction. Inventory workspace (2) and real WIP allocation/three-slot coverage (1) passed in the preceding run. These are 27 distinct targeted browser checks, not an all-route certification.
- Local GRN: real stock mutation, per-roll label PDF, canonical trace deep link and reprint verified. Scanner handling tests cover exact match, duplicate scan, missing match and ambiguous supplier reference; hardware scanning remains open.
- Tablet sign-in inspected at 834 × 1112: form first, document width 834, sign-in button within the viewport.
- Live AWS baseline: 2,058 tracked source hashes match e393c42 before the release. Read-only reservation preflight passed with 5,905 roll records.
- Pre-release database and source backup SHA-256 verified; PostgreSQL dump restored with ON_ERROR_STOP into an isolated, network-disabled temporary container: 5,905 rolls and 366 migration records. Temporary restore container removed. This proves same-host restore readability; off-host recovery is still a separate gate.

- Rendered label QR decoded independently to its expected immutable roll UUID. This validates the generated image, not physical print/scanner quality.

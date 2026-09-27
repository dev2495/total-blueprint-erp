# Release candidate: hardening and roll allocation

This candidate includes the previously verified UI/read-performance changes and the 27 September hardening fixes. Existing pricing, production and approval rules are preserved.

## Verification

- Prior full Django suite: 1,017 tests OK, two skips; focused concurrency/MRP/artwork 13; query/race checks 4; quotation commercial regressions 15.
- Prior 277 browser gate scenarios and 23 mutation/observation scenarios passed across initial runs and documented targeted reruns. These are not a single clean run on the final source.
- Additional allocation review: explicit material/family matching, full target-spec identity preservation, stable tab selection and retained hidden selections.
- Allocation backend suites: 23 tests passed. Shared filter checks: 11 assertions passed. Lint, typecheck and production build passed. Real WIP lineage/fallback/three-slot browser allocation passed. Selection/filter payload browser regression is recorded in the release handoff.
- Dependency audits reported zero known advisories; actual local restored-database smoke passed.

## Deployment

User authorized commit and AWS release. The documented host is 3.6.77.159 / erp.totalpolyprint.com; the current SSH identity is denied and the runbook key is missing. Production source/image identity and migrations must be inspected after access is supplied. No deployment has yet been performed. Preserve runtime volumes and secrets, take and verify a pre-release backup, retain rollback images, then deploy this immutable commit with production migrations 0071 and sales 0041 and perform signed-in acceptance.

## Separate review

A separate review-only task is preparing a visual HTML report on premium ERP UI/analytics/user journeys and official ERP comparisons. No proposed redesign or business logic change is authorized in that task.

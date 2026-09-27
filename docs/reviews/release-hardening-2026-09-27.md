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

## AWS reconciliation before deployment

AWS access was recovered using the existing Lightsail key. The server release marker is `95725fadf4a2e32015fc3f4e84d5952a7066f350`; that commit is unavailable from this GitHub remote, so the read-only live source snapshot is the reconciliation authority. Comparison found 252 files different from both base and candidate, plus 31 server-only files (including evidence). Current premium UI, print-colour revision workflow, dispatch PDF fixes and stricter physical roll matching were preserved. Fourteen overlapping files were reconciled; rewritten report and logistics screens retain the live implementation, with empty-cohort safeguards ported to the new report renderer. The existing print-colour migration and concurrent board-index migration join through a no-operation merge migration.

Additional WCM safeguards: explicit variants take precedence over family matches, different layer width/basis/slit-policy contracts remain distinct, and filtering cannot silently omit selected rolls from submission. A legacy payload test now supplies its required physical layer contract. No customer database fixtures are used for live verification.

Predeployment backup: `/opt/tpp-erp/backups/daily/tpp-erp-db-20260927-143336+0530.sql.gz` passed gzip and SHA-256 checks. Source archive `/opt/tpp-erp/releases/pre-hardening-20260927.tgz` passed tar validation. Previous backend/frontend images are retained with `rollback-20260927` tags. These verify archive integrity; they do not constitute a new full production restore drill.

Reconciliation checks: optimized frontend build and lint pass. Focused backend allocation/physical-contract tests: 17 pass. Browser: filtered-selection payload passes; real lineage/manual fallback and three-slot allocation flow passes (13.2 seconds). The first combined 1,037-test run had only the legacy missing-contract fixture failure; the corrected complete rerun is recorded in deployment evidence.

# Full-Stack Production Release and Security Report

Date: 2026-07-13  
System: Total Poly Print ERP  
Production: `https://erp.totalpolyprint.com` on AWS Lightsail `3.6.77.159`  
Reviewed source: `stock_lifecycle_worktree`, branch `codex/planner-sales-latest-20260629`  
Deployed code commit: `6a94a9f` (`Deduplicate canonical material aliases`)  
Production runtime source-manifest SHA-256 (this report excluded): `27deabe3cf9899bd9b46cbfc9220e833ab0b5d36a5e755f8c2fb2bb369f1757d`

## Executive verdict

**Application release status: GREEN and deployed.**

The order-entry, Product Master, template/versioning, route, planner propagation, dependency, container-security, backup, and authentication defects found during the incident review have been repaired. The final backend code passed all 883 tests both locally and inside the exact Python 3.12 production image. The frontend passed lint, type generation, TypeScript, version-label privacy, navigation, help coverage, formula-parser, dependency-audit, and optimized Next.js production-build gates. The final backend image is live on AWS, all services are running, backend/frontend are healthy, Celery worker and Beat are operational, production logs have no new error/critical/traceback entries, and the deployed tracked-source manifest exactly matches the local commit.

The specific Product Master from the supplied screenshot, `c85f4bd1-8f1a-4c89-b132-8bf880881cf6`, now validates successfully in production with no serializer errors. Its historical `PP-TUBING` reference resolves to the current `PP-MONO` material identity, and duplicate canonical options have been removed.

This is not an unconditional “nothing can ever fail” claim. Three external follow-ups remain outside the deployed application patch:

1. The release commits are local and live on AWS, but GitHub push is blocked because the configured GitHub token is invalid and SSH authentication has no accepted key.
2. Automated encrypted backups and restore drills pass, but the managed application backup provider is still `LOCAL`; an off-host S3/object-storage destination needs AWS credentials and a bucket to protect against total host loss.
3. No real production user password was provided, so destructive authenticated mutations were not replayed against live customer data. They were covered in the isolated regression and UI suites; live production verification was read-only and anonymous-boundary only.

## What caused the incident

### 1. A film variant was renamed without preserving every old reference

The screenshot failure was precise: layer 1 still contained `pp-TUBING`, while the active film master was now `PP-MONO`. The previous serializer treated the historical name as a missing alternate and rejected the entire Product Master save with HTTP 400.

Resolution:

- Added persistent former-code aliases tied to the same material UUID.
- Added the reviewed production mapping `PP-TUBING -> PP-MONO`; no fuzzy or name-based substitution is permitted.
- Film variant renames now automatically retain the old code as an active alias.
- Product Master saves canonicalize aliases to the current code.
- Canonicalized option arrays are order-preserving and deduplicated, preventing old and new names from appearing as two choices.
- The deterministic repair command canonicalized the affected production master, then a second dry run reported zero pending repairs or unresolved references.

### 2. Normal edits behaved like new versions

The old flow cloned Product Masters/templates too aggressively. That exposed version suffixes, changed internal names during ordinary edits, retired valid records, and left users selecting stale or missing master/template rows.

Resolution:

- Normal Product Master edits now update the current master through `workspace-save`; they do not create a revision.
- A replacement revision requires an explicit controlled action and confirmation.
- Product Master internal codes are immutable during normal edits.
- APIs retain version lineage as backend governance metadata.
- User-visible labels and selectors use stable display codes/names and strip version suffixes.
- A build-blocking privacy gate scans the frontend for user-facing version/revision labels.
- Product/order quick-start selectors exclude inactive, superseded, or invalid masters.

Versioning itself was not inherently the problem. The defects were uncontrolled clone-on-save behavior, visible governance identifiers, missing aliases, and stale downstream snapshots. Version history remains in the backend for auditability while normal users see stable business names.

### 3. Template/route edits could leave orders and queues stale

Master/template saves previously suppressed downstream refresh exceptions. A save could appear successful even when an eligible open order or pre-release planner job failed to rebuild. That created the “worked yesterday” and “routes disappeared” behavior.

Resolution:

- Master/template propagation is fail-closed and transactional.
- If any eligible snapshot or pristine pre-release job cannot refresh, the edit rolls back and reports the real failure.
- Fault-injection tests prove that a second-line failure cannot partially commit the master edit or first-line refresh.
- Mutable open demand and pristine pre-release jobs are revised to the current master/template/route/BOM.
- Planner-decision work remains `PLANNING_REQUIRED`; edits do not silently dispatch work.
- Allocated, released, started, completed, or inventory-provenance execution remains frozen as historical truth.
- Retry/rebuild behavior is idempotent.
- The reviewed legacy route alias `BOPP Sheet Fold -> Sheet Seal` and verified master/template restorations are deterministic; the repair command never guesses mappings.

### 4. Product Master editing and quotation/order flows were inconsistent

Resolution:

- Product Master normal save uses the supported workspace endpoint instead of clone-on-save.
- Save-before-send and save-before-approve are enforced for quotations.
- Order and quotation selectors use only active/current valid masters and sizes.
- Product/template changes preserve customer-facing line names while refreshing execution snapshots.
- Formula evaluation uses an allowlisted parser; the client-side `new Function` fallback was removed.
- Backend and frontend quantity-formula parity covers arithmetic, rounding, invalid syntax, division by zero, and missing inputs.

## Business rules now enforced

| Scenario | Required behavior | Verified result |
|---|---|---:|
| Rename film variant | Preserve former code as alias to same material identity | PASS |
| Normal Product Master edit | Edit current record; no automatic revision | PASS |
| Explicit replacement revision | Create controlled lineage only after confirmation | PASS |
| Master/template propagation failure | Roll back edit and all partial refreshes | PASS |
| Open, untouched order line | Refresh to current master/template snapshots | PASS |
| Pristine pre-release planner job | Rebuild from refreshed route/BOM | PASS |
| Planner-decision line | Remain `PLANNING_REQUIRED` | PASS |
| Allocated/released/started/completed execution | Remain frozen | PASS |
| Customer-facing name | Stay stable during backend revision refresh | PASS |
| User-facing version identifiers | Never render in application UI | PASS |
| Invalid route/material/grade/formula | Reject with explicit validation; no partial save | PASS |

## Security and reliability remediation

| Finding from 2026-07-11 review | Final state |
|---|---|
| Application backups failed because worker lacked `pg_dump` | PostgreSQL 16 client is in the shared backend/worker image; backup succeeds |
| Backup target was ephemeral | Persistent host volume `/opt/tpp-erp/backups` is mounted |
| Retry attempts created misleading duplicate failures | Celery task ID is reused as an idempotency key |
| No backup-recency readiness/alert | Backup age is part of readiness and operational alerts |
| No restore proof | Encrypted post-deploy backup plus isolated restore drill succeeded |
| Vulnerable Django 6.0.6 | Locked Django 6.0.7; Python audit reports zero known vulnerabilities |
| Vulnerable frontend dependencies | Next 15.5.20, Axios 1.18.1, js-cookie 3.0.8, PostCSS 8.5.18; npm audit is zero |
| Floating Python dependencies | Hash-locked production requirements; Docker uses `--require-hashes` |
| Backend/Celery ran as root | Shared image runs as `tpp`, UID/GID 10001 |
| Broad container privilege | `cap_drop: ALL` and `no-new-privileges` on backend, worker, Beat, and frontend |
| Beat schedule permission failure | Persistent schedule file is in the writable log volume and owned by `tpp` |
| Missing frontend HSTS/CSP | Site-wide HSTS and nonce-based strict CSP are live |
| Next.js disclosure | `X-Powered-By` is disabled |
| Broad legacy CORS/CSRF origins | Only canonical HTTPS production origin is trusted |
| Detailed public readiness | Public readiness returns a minimal ready/not-ready response |
| Dynamic JavaScript formula execution | Replaced with an allowlisted parser |
| Noisy anonymous session bootstrap | Quiet scoped HttpOnly session discovery returns 200 without leaking data |

Additional controls verified:

- `DEBUG=False` and hosted configuration fails closed when secrets/hosts/origins/database credentials are missing.
- JWT cookies are Secure and HttpOnly; unsafe cookie-authenticated requests require CSRF.
- DRF access defaults to authenticated, permission-scoped endpoints.
- Anonymous `/api/master/products/` returns 401 with no product data.
- Password policy, login failure, refresh/logout CSRF, role permissions, and master-data audit paths have regression coverage.
- Host ports for backend and frontend bind to loopback behind Caddy; Postgres and Redis remain on the private Docker network.
- Raw-IP HTTP redirects to the canonical HTTPS domain.
- Login HTML has strict CSP, HSTS preload, frame denial, MIME sniffing protection, a restrictive permissions policy, and no framework-powered header.
- No private key or live environment file is tracked in Git.
- No attacker-controlled raw HTML sink, raw SQL injection path, or shell-command injection path was confirmed in reviewed application code.

## Final verification matrix

| Gate | Result | Evidence |
|---|---:|---|
| Targeted renamed-film regression | PASS | Historical + current option saves once as canonical code |
| Local backend suite | PASS | 883/883, 0 failed |
| Exact production-image backend suite | PASS | Python 3.12 image, 883/883 in 203.321s, exit 0, UID/GID 10001, no OOM |
| Django migration drift | PASS | No model changes detected; `migrate --check` clean |
| Django production check | PASS | `check --deploy`: 0 issues in AWS environment |
| Frontend lint | PASS | 0 errors |
| Frontend types | PASS | Theme guard, Next route types, and `tsc --noEmit` passed |
| Frontend optimized build | PASS | Next.js 15.5.20 production build completed |
| Version-label privacy | PASS | No user-facing version/revision identifiers |
| Navigation | PASS | 79 sidebar routes; 141 resolver routes |
| Help coverage | PASS | 170 routes; 170 PageGuides; 11 role guides; 13 flows |
| Quantity formulas | PASS | Safe-parser checks passed |
| JavaScript dependency audit | PASS | 0 vulnerabilities |
| Python dependency audit | PASS | 0 known vulnerabilities |
| Full isolated UI release suite | PASS | 280/280: 257 gate, 13 mutations, 10 observations |
| AWS runtime-source parity | PASS | Local and remote manifest hash both `27deabe3...f1757d`; this report is excluded |
| Active current Product Masters | PASS | 18 checked in production; 0 invalid |
| Revision integrity | PASS | 0 pending/unresolved aliases, masters, routes, bindings, redirects, or stale rebases |
| Exact screenshot Product Master | PASS | Active/current; serializer valid; no errors; canonical options deduplicated |
| Live health | PASS | `/api/health/ready/` returns 200 minimal ready response |
| Live anonymous boundary | PASS | Quiet session discovery 200 anonymous; protected master API 401 with no data |
| Live representative routes | PASS | Login, Product Master edit, order create, quotation create, planner queue, and work center all return 200 HTML |
| Production service state | PASS | Backend/frontend healthy; Postgres/Redis healthy; worker/Beat running |
| Celery | PASS | Worker ping returns `pong`; Beat sends scheduled tasks from persistent schedule DB |
| Production log scan | PASS | No new traceback/critical/permission-denied/internal-error entries after rollout |
| Host database backup | PASS | `tpp-erp-db-20260713-134500+0530.sql.gz`; checksum sidecar verifies |
| Managed encrypted backup | PASS | `erp_db_20260713_081915.dump.enc`, 7,909,168 bytes, checksum recorded |
| Restore drill | PASS | `SUCCEEDED`, smoke test true, RPO 0 minutes, RTO under 1 minute |

## Production deployment evidence

- Backend/worker/Beat image: `sha256:831db602b01c7a3db52d61ff4cf25db019d8102b6de0baa3c9fcc4b2355d91be`
- Frontend image: `sha256:e819b01802be4d8cee3d8cdd0348f08c7169e34de49fee7258f1167b96a134a1`
- Backend, worker, and Beat run the same immutable Python image as user `tpp`.
- Frontend runs as user `node`.
- All four application containers have `cap_drop=[ALL]` and `no-new-privileges`.
- Celery Beat schedule: `/var/log/tpp-erp/celerybeat-schedule`, persisted to the host log volume and owned by UID/GID 10001.
- Production created five sales orders in the preceding 24 hours; no live customer mutation was generated by this release verification.
- No unresolved operational alerts remained at final check.

## Remaining external follow-ups

### [P1][SCM] Push the commits after GitHub reauthentication

`git push` cannot authenticate. `gh auth status` reports the configured token invalid, and SSH is rejected with `Permission denied (publickey)`. The source is committed locally and the exact committed tree is deployed on AWS, but the remote GitHub repository is not yet synchronized.

Required owner action:

```text
gh auth login -h github.com
```

After authentication, push branch `codex/planner-sales-latest-20260629` and confirm remote commit `6a94a9f` or the final report commit.

### [P1][DR] Configure an off-host backup destination

The application-managed backup is encrypted and persistent but reports provider `LOCAL`. This covers container loss and supports restore drills, but it does not cover complete Lightsail-host loss.

Required owner action: provide a private S3-compatible bucket and least-privilege write/read credentials through `BACKUP_S3_BUCKET`, region/endpoint, prefix, and secret storage. Then run one backup, verify the remote object checksum, restore it into an isolated database, and retain evidence.

### [P2][UAT] Run one authenticated live smoke with a dedicated test user

No production credential was supplied. A dedicated non-customer test account should verify, on live production:

1. Edit and save a test Product Master using a historical film alias.
2. Confirm the UI continues to show stable business names without version numbers.
3. Place a test order and confirm snapshot/route/BOM creation.
4. Edit the linked test template/master and confirm only the open untouched line and pristine pre-release queue revise.
5. Confirm a released/executed test job remains frozen.
6. Cancel or archive the test order under the documented UAT procedure.

### [P2][AWS] Control-plane review requires AWS account access

Host and application controls were reviewed. IAM policies, Lightsail firewall rules, account MFA, CloudTrail, DNS registrar security, billing alarms, and automated Lightsail snapshots were not accessible from the repository/host session and are not certified here.

## Final conclusion

The original application failures have been corrected at their causes rather than hidden by UI workarounds. Historical names are now stable aliases, ordinary edits no longer manufacture user-visible versions, master/template propagation is atomic, mutable orders and pre-release queues revise safely, released execution is frozen, dependency and container findings are remediated, and backup/restore controls are operational.

The AWS application is healthy and production-ready at the deployed runtime level. An honest full operational closure still requires GitHub reauthentication, off-host backup credentials, and an authenticated live UAT account; those depend on owner-controlled external access rather than additional application code.

# Full-Stack Production Release, Logic, Flow, and Security Report

Date: 2026-07-13

System: Total Poly Print ERP

Production: `https://erp.totalpolyprint.com` on AWS Lightsail `3.6.77.159`

Reviewed source: `stock_lifecycle_worktree`, branch `codex/planner-sales-latest-20260629`

Deployed source commit: `a0a93c2e99ea5fe20c5a0a6994481b2cbfcdff9b` (`Remove public legacy mockup assets`)

Core release tracked-source manifest SHA-256 (commit `b95066d`, this report excluded): `ca62c8da8c92954398517007b216bc19365b725b2e524f872e06023ba411f34c`

Post-release frontend hardening source parity: `frontend_v2/scripts/check-user-facing-version-labels.mjs` SHA-256 `1757861d21b789da958ee0ef0de715357e3f985c459dbb7c22a8647bdc33687f` matched local and AWS.

## Executive verdict

**Application release status: GREEN, deployed, and independently rechecked after rollout.**

The order-placement, Product Master editing, historical material-name compatibility, template and route propagation, planner pre-release rebuild, fail-closed transaction handling, authentication rollover, route compatibility, large-page rendering, dependency, container-hardening, backup, and restore defects found during the incident investigation have been fixed at their sources.

The final backend source passed **906/906 tests locally** and the same **906/906 tests inside the exact Python 3.12 production image**. The final production-mode browser suite passed **289/289 tests** across the release gate, mutation flows, and observation flows. Frontend lint, generated route types, TypeScript, the optimized Next.js build, navigation coverage, help coverage, version-label privacy, formula-parser checks, dependency audits, Django checks, and migration checks all passed.

AWS was deployed from clean committed archives. The core full-stack release was commit `b95066d`; the final frontend hardening release is commit `a0a93c2`. Backend and frontend are healthy, Postgres and Redis are healthy, the Celery worker and Beat are running, the worker answers `pong`, representative user routes return HTTP 200, and repeated post-deploy log scans found no traceback, critical, permission-denied, internal-server-error, unhandled, or fatal entries. The final frontend image has zero restarts and no OOM event.

The Product Master shown in the incident screenshot, `c85f4bd1-8f1a-4c89-b132-8bf880881cf6`, is active/current and validates successfully in production with no serializer errors. Its historical `PP-TUBING` reference resolves to the same material identity as `PP-MONO`, while current choices are canonical and deduplicated. All **19 active/current Product Masters** were revalidated in production; **zero were invalid**.

This report does not promise that software can “never fail.” It records the controls and evidence that make these specific failures detectable, transactional, recoverable, and release-blocking. Four owner-controlled operational items remain outside the deployed code patch: GitHub authentication, off-host backup IAM/bucket configuration, a dedicated production UAT identity, and the AWS account-level control-plane audit. These are detailed under Remaining owner actions.

## Incident causes and permanent corrections

### 1. Historical material names could invalidate an otherwise valid Product Master

The supplied error named the exact failing value: layer 1 contained historical film code `pp-TUBING`, while the active film master is `PP-MONO`. The old validation path treated the historical code as a missing alternate and rejected the Product Master mutation with HTTP 400.

Corrections:

- Former codes are persistent aliases tied to the same material UUID; the reviewed production mapping is `PP-TUBING -> PP-MONO`.
- Renaming a film variant automatically retains the old code as an active alias.
- Product Master saves canonicalize a recognized alias to the current code.
- Option arrays are canonicalized, order-preserving, and deduplicated so users do not see old and new codes as separate materials.
- No fuzzy, similarity-based, or name-guessing substitution was introduced.
- The deterministic integrity repair now checks aliases, orphaned masters, bindings, routes, redirects, and stale rebases. The final production dry run reported zero planned, applied, or unresolved repairs.

### 2. Normal edits were incorrectly entangled with revision creation

The previous behavior cloned Product Masters/templates too readily. That exposed internal version identifiers, changed visible names, retired otherwise valid records, and let users encounter stale selections.

Corrections:

- An ordinary Product Master edit updates the active/current workspace; it does not create a revision.
- A replacement revision remains an explicit controlled action with confirmation.
- Stable business codes/names are shown to users; lineage identifiers remain backend governance metadata.
- Normal editing cannot mutate the Product Master identity code.
- Active selectors exclude inactive, superseded, or invalid records.
- A build-blocking privacy scan covers frontend source and localized help content and rejects user-facing version/revision language.
- All 57 remaining localized user-facing `V36` strings were removed.

Versioning was therefore not the sole problem. The failure was uncontrolled clone-on-save behavior combined with visible internal identifiers, missing aliases, and stale downstream snapshots. Audit lineage remains available to the backend without leaking its numbering into day-to-day user workflows.

### 3. Template and route changes could partially refresh downstream work

Some prior propagation paths suppressed refresh exceptions. A save could appear successful after updating the master while an eligible open order or pristine pre-release planner job remained stale.

Corrections:

- Master/template propagation is transactional and fail-closed.
- A downstream refresh error rolls back the edit and any earlier partial refresh in the same transaction.
- Open untouched order demand and pristine pre-release jobs are rebuilt from the current approved master/template/route/BOM.
- Planner-decision demand remains `PLANNING_REQUIRED`; an edit does not dispatch it silently.
- Allocated, released, started, completed, or inventory-provenance execution stays frozen as historical truth.
- Retry/rebuild behavior is idempotent.
- Route graph, lamination-pass, template-step, BOM, packaging-demand, and web-width lookups now propagate real failures instead of silently selecting a legacy or heuristic route.
- The reviewed route alias `BOPP Sheet Fold -> Sheet Seal` is deterministic; repair logic does not invent business mappings.

### 4. Business mutations had silent-failure and partial-commit paths

The full-stack re-review found additional paths where a failed dependency could leave a misleading success or a partial write.

Corrections:

- Sales-order confirmation fails closed when layer-hash or web-width evaluation fails.
- Sales-order cancellation rolls back if its mandatory audit write fails.
- Trade-stock adjustments reject NaN, Infinity, invalid average cost, and cost-save failure; failed mutations roll back.
- Job creation and source-layer assignment are atomic, with stable material identity and generic-stock metadata preserved.
- In-house packaging demand update failures are no longer suppressed.
- Roll-allocation preview and slit operations fail closed; failed slits roll back.
- A configured but missing or malformed pouch opening dimension blocks BOM preview instead of producing misleading geometry.
- Quotation production preview rejects non-finite/negative quantities, invalid geometry/material data, and invalid UOM and propagates material-lookup failures.
- Execution template roll policy, pass, and requirement errors are no longer replaced with guessed defaults.
- Operator output is not logged unless input reservation re-satisfaction succeeds.
- Backup retention deletes the artifact before the database record; an untraceable deletion cannot silently erase the audit row and raises a critical operational alert.

### 5. Authentication refresh could fail after a long-running browser session

Login, refresh, logout, and CSRF bootstrap requests could be intercepted by an expired access cookie before the refresh token was evaluated. That made long-lived workflows fail late even when refresh credentials were still valid.

Corrections:

- The public authentication endpoints bypass expired access-token authentication while retaining CSRF, refresh-token, credential, and revocation validation.
- Logout audit identity is resolved from the refresh token.
- The browser fixture now refreshes early and performs a clean login if refresh cannot recover the session.
- A final 28-minute production-mode browser gate passed through token rollover, including the last WIP route.

### 6. Compatibility routes and one large engineering page were fragile

Corrections:

- Compatibility redirects now exist for `/inventory/addons-v36`, `/inventory/grn-history-v36`, `/inventory/grn-v36`, `/inventory/inter-plant-v36`, and `/inventory/traceability-v36`, alongside existing bulk, packaging, and rolls shims.
- Help canonicalizes eight legacy aliases and excludes redirect-only shims from the visible guide registry.
- The engineering routing page no longer renders 5,807 cards at once. It includes search, shows 24 initially, and adds 24 per user request.
- The deep verification script now fails on every unexpected non-2xx/3xx response, including 404, so missing routes cannot pass a release gate.
- Browser test configuration consistently targets the production-mode frontend on port 3001.

### 7. Obsolete mockup pages were still publicly served

The follow-up static audit found twelve legacy mockup HTML files in `frontend_v2/public/`. They were not application routes, but Next.js served them directly, including `/pm-v36-detail.html` and `/inventory-v36-grn.html`. The pages exposed technical version names and used raw DOM transforms unsuitable for an unauthenticated production surface.

Corrections:

- Removed all twelve mockup pages from the shipped `public/` directory; eleven byte-identical copies remain only in `docs/mockups/`, and the unique v35 mockup was moved there.
- Preserved actual application compatibility routes such as `/inventory/grn-v36` and `/inventory/traceability-v36` so existing bookmarks/workflows still work.
- Extended `frontend_v2/scripts/check-user-facing-version-labels.mjs:105-120` to reject versioned user-reachable public filenames and technical version labels in public HTML at build time.
- Rebuilt the optimized frontend locally and on AWS from commit `a0a93c2`.
- Live probes confirm the three former mock assets return 404 and the real compatibility routes plus the affected Product Master edit route return 200.

## Business lifecycle invariants

| Scenario | Required behavior | Final result |
|---|---|---:|
| Rename material/film variant | Preserve former code as alias to the same UUID | PASS |
| Save with recognized historical code | Canonicalize to current code once, without duplicates | PASS |
| Normal Product Master edit | Update current record; do not auto-create revision | PASS |
| Explicit replacement revision | Controlled lineage action after confirmation | PASS |
| Product Master identity | Stable during ordinary edits | PASS |
| User-visible naming | Stable business label; no backend revision number | PASS |
| Master/template propagation error | Roll back master edit and every partial downstream refresh | PASS |
| Open untouched order line | Refresh approved snapshots | PASS |
| Pristine pre-release planner job | Rebuild from current route/BOM | PASS |
| Planner-decision demand | Remain `PLANNING_REQUIRED` | PASS |
| Allocated/released/started/completed work | Remain frozen as execution history | PASS |
| Inventory provenance | Never silently rebase to a new master revision | PASS |
| Retry | Idempotent; no duplicate job/demand mutation | PASS |
| Invalid material/route/formula/geometry | Explicit rejection; no partial commit | PASS |
| Failed mandatory audit or costing write | Entire business mutation rolls back | PASS |
| Missing configured template dimension | Block preview; do not guess | PASS |

## Security and reliability controls

| Reviewed control | Production state |
|---|---|
| Dependency vulnerabilities | `npm audit`: 0; `pip-audit`: no known vulnerabilities; `pip check`: clean |
| Backend runtime user | `tpp`, UID/GID 10001 |
| Frontend runtime user | `node` |
| Linux capabilities | `cap_drop: ALL` on backend, worker, Beat, and frontend |
| Privilege escalation | `no-new-privileges:true` on all application containers |
| Secret/config fail-closed behavior | Hosted startup rejects missing secrets, hosts, origins, or DB settings |
| Browser protections | Strict nonce CSP, HSTS preload, DENY framing, MIME protection, restrictive permissions/referrer policies |
| Framework disclosure | No `X-Powered-By` header |
| Cookie/auth protection | Secure HttpOnly JWT cookies; CSRF required for unsafe cookie-authenticated requests |
| Anonymous data boundary | Session discovery returns anonymous state; protected Product Master API returns 401 with no data |
| Network exposure | App ports bind to loopback behind Caddy; Postgres/Redis have no host binding |
| Canonical origin | Raw IP HTTP redirects to the production HTTPS domain |
| Formula execution | Allowlisted parser; no dynamic `new Function` fallback |
| Readiness disclosure | Minimal ready/not-ready response only |
| Backup operation | Encrypted, checksummed, persistent, retention failure alerts, isolated restore drill |
| Release-source parity | Exact SHA-256 manifest parity between committed source and AWS runtime |
| Runtime health | Container health checks, Celery ping, route probes, log scan, restart/OOM inspection |

Additional review conclusions:

- `DEBUG=False` is enforced in hosted production.
- DRF defaults remain authenticated and permission-scoped.
- Password policy, failed login, refresh/logout CSRF, role permission, and master-data audit behavior have regression coverage.
- No private key or live environment file is tracked in the reviewed Git tree.
- No confirmed attacker-controlled raw HTML sink, raw SQL injection path, or shell-command injection path remained in the reviewed application code.
- Containerized backend, worker, and Beat use one immutable backend image, reducing dependency drift.
- The startup script now terminates only the bounded workspace process group and gives processes up to 20 seconds for graceful shutdown.

## Final verification matrix

| Gate | Result | Evidence |
|---|---:|---|
| Local backend suite | PASS | **906/906**, 130.359s, exit 0 |
| Exact production-image backend suite | PASS | Python 3.12, UID/GID 10001, **906/906**, 216.802s, exit 0 |
| Django migration drift | PASS | No model changes; `migrate --check` clean |
| Django production checks | PASS | System checks and AWS `check --deploy`: 0 issues |
| Frontend lint and types | PASS | Lint, generated route types, and `tsc --noEmit` passed |
| Optimized frontend build | PASS | Next.js 15.5.20 production build passed locally and on AWS |
| User-facing revision privacy | PASS | Source plus localized-help scan clean |
| Navigation coverage | PASS | 79 sidebar routes; 141 resolver routes |
| Help coverage | PASS | 167 routes; 167 PageGuides; 11 roles; 13 flows |
| Quantity/formula parser | PASS | Safe arithmetic, rounding, invalid syntax, zero division, and missing input checks passed |
| JavaScript audit | PASS | 0 vulnerabilities |
| Python audit | PASS | No known vulnerabilities; no broken requirements |
| Production-mode browser gate | PASS | **266/266**, 28.0m |
| Browser mutation flows | PASS | **13/13**, 3.7m |
| Browser observation flows | PASS | **10/10**, 2.0m |
| Full browser release suite | PASS | **289/289**, 0 failed, 0 skipped |
| Core runtime-source parity | PASS | Commit `b95066d` local/remote manifest `ca62c8da...11f34c` |
| Post-release frontend source parity | PASS | Current privacy gate SHA-256 matched local/AWS: `1757861d...c33687f` |
| Public legacy mockup retirement | PASS | `/pm-v36-detail.html`, `/inventory-v36-grn.html`, and `/pm-v35-mockup.html` return 404 |
| Real compatibility routes after retirement | PASS | `/inventory/grn-v36`, `/inventory/traceability-v36`, and Product Master edit return 200 |
| Active/current Product Masters | PASS | **19 checked**, 0 invalid |
| Revision integrity | PASS | 0 planned/applied/unresolved aliases, masters, bindings, routes, redirects, or stale rebases |
| Screenshot Product Master | PASS | Active/current; serializer valid; no errors; canonical options deduplicated |
| Live readiness | PASS | `/api/health/ready/` returns HTTP 200 minimal `ready` response |
| Live auth boundary | PASS | Anonymous session 200/unauthenticated; protected products API 401/empty |
| Representative routes | PASS | Login, exact Product Master edit, order create, quotation create, planner, work center, new compatibility routes, and engineering routing return 200 |
| Production services | PASS | Backend/frontend/Postgres/Redis healthy; worker/Beat running |
| Celery | PASS | One worker node answers `pong` |
| Production log scans | PASS | Repeated 5-, 10-, and final 15-minute scans found no target error signatures |
| Idle resource check | PASS | Backend 0.04% CPU/245.1 MiB; frontend 0.00%/178.6 MiB |
| Application restarts/OOM | PASS | Released app services: 0 restarts; OOM false |
| Pre-deploy host dump | PASS | `tpp-erp-db-20260713-191623+0530.sql.gz`; checksum sidecar verified |
| Pre-deploy encrypted backup | PASS | Record `3d6fa2d2-8367-4dd5-9715-abfd9899cd14`; checksum verified |
| Post-deploy encrypted backup | PASS | Record `5b6400dc-4954-4fce-bd5e-dc4702e18963`; checksum verified |
| Isolated restore drill | PASS | Record `0969f26a-be80-4392-b6f0-6cfe31d08691`; smoke true; RPO 0; RTO 0; 8s |
| Operational alerts | PASS | 0 unresolved application alerts at final check |

## Deployment and recovery evidence

### Immutable release

- Core deployed source: `b95066d2e3f2686d0e0fd1f004863c6539d0c4f6`.
- Final frontend hardening source: `a0a93c2e99ea5fe20c5a0a6994481b2cbfcdff9b`.
- Source archive was created from the clean committed tree, not from an uncommitted working directory.
- Core local/remote manifest: `ca62c8da8c92954398517007b216bc19365b725b2e524f872e06023ba411f34c`.
- Final frontend gate source hash local/AWS: `1757861d21b789da958ee0ef0de715357e3f985c459dbb7c22a8647bdc33687f`.
- Backend/worker/Beat image: `sha256:c014900f50748e9058705a4d5fe6e2435800d798fd7e908c2dab6b0dd18dacd4`.
- Core-release frontend image: `sha256:7472b0e6c54aa4cca014420a1da01c9b1ea20c1ffbddccf8a39566bf810a5751`.
- Current frontend image: `sha256:69d4732cf5239383adff3a5688265b1c85e0d4ba93eea36d848ab3d100545b2e`.
- Migration check passed before rollout; `migrate --noinput` reported no migrations to apply.
- The core release recreated backend, worker, Beat, and frontend. The final hardening recreated only frontend; database, Redis, backend, worker, and Beat were deliberately left untouched.

### Backup and restore

- Pre-deploy host dump: `/opt/tpp-erp/backups/daily/tpp-erp-db-20260713-191623+0530.sql.gz`; sidecar checksum verified.
- Pre-deploy encrypted managed artifact: `erp_db_20260713_134654.dump.enc`, 7,958,800 bytes, SHA-256 `edd347f0813f11ecf928f462afe9557881fa7d2cf869b2a606d139033599b819`.
- Pre-deploy backup record: `3d6fa2d2-8367-4dd5-9715-abfd9899cd14`, `SUCCEEDED`, provider `LOCAL`.
- Post-deploy encrypted artifact: `erp_db_20260713_135650.dump.enc`, 7,958,880 bytes, SHA-256 `7a43f940b3a010d9764a7c5e23bfb16729266e7b14b68017422ed480cf11cf16`.
- Post-deploy backup record: `5b6400dc-4954-4fce-bd5e-dc4702e18963`, `SUCCEEDED`, provider `LOCAL`.
- Restore drill record: `0969f26a-be80-4392-b6f0-6cfe31d08691`, `SUCCEEDED`; isolated smoke test true; RPO 0 minutes; RTO 0 minutes; duration 8 seconds.

### Final live state

- Backend and frontend health checks are healthy.
- Postgres and Redis health checks are healthy.
- Worker and Beat are running; worker ping returns `pong`.
- Backend/frontend ports bind only to `127.0.0.1`; public HTTP/HTTPS terminate at Caddy.
- Public readiness returned HTTP 200 at the final check.
- Final frontend hardening image is healthy with 0 restarts and `OOMKilled=false`.
- Former direct mockup URLs return 404; valid compatibility and Product Master routes return 200.
- No target error signatures appeared in the final 15-minute application log window.
- No unresolved application operational alerts remained.

## Remaining owner actions

These are real production-governance gaps, but none is an unpatched application defect.

### [P1][SCM] Reauthenticate GitHub and push the release/report commits

The non-interactive HTTPS push failed because this workstation has no valid GitHub credential. The existing GitHub CLI token is invalid, and the tested SSH path has no accepted key. The source commit is local and the exact source is live on AWS, but GitHub is not synchronized.

Five supported recovery paths were reviewed: GitHub CLI browser authentication, a fine-grained HTTPS token, an account SSH key, a repository deploy key, or a GitHub App installation token. For this interactive developer workstation, use the GitHub CLI browser flow so the token is placed in the macOS credential store:

```text
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
git push origin codex/planner-sales-latest-20260629
```

Do not paste a token into this report, a shell argument, or the repository. After the owner authenticates, confirm that the remote contains `a0a93c2` and the final report commit.

### [P1][DR] Configure an off-host encrypted backup destination

The verified artifacts are encrypted and persisted outside the containers, but provider `LOCAL` does not protect against complete Lightsail-host loss. The current instance role is `AmazonLightsailInstanceRole`; it does not have access to a dedicated application backup bucket.

Required owner action:

1. Create or nominate a private, versioned S3-compatible bucket with public access blocked.
2. Grant the instance a least-privilege role scoped to the application backup prefix; prefer a role over long-lived access keys.
3. Set `BACKUP_S3_BUCKET`, region/endpoint, and prefix through the production secret/configuration channel.
4. Run one encrypted backup, verify the remote object checksum, restore it into an isolated database, and retain the evidence.
5. Add lifecycle retention and an alert for missed/off-host backup age.

### [P2][UAT] Create a dedicated non-customer production test identity

There is no dedicated production username matching UAT/test/E2E/Codex. Real customer identities were not impersonated and live customer records were not mutated during verification. The isolated backend and production-mode browser suites cover the flows, while live checks were read-only and anonymous-boundary checks.

Once a dedicated test user and test tenant/data policy exist, execute and clean up this live UAT scenario:

1. Edit a test Product Master using a historical film alias and confirm it saves canonically.
2. Confirm only stable business names appear and no version/revision number is user-visible.
3. Place and confirm a test order; verify the route, BOM, and planner demand.
4. Edit the linked test template/master; verify only the open untouched order line and pristine pre-release job rebuild.
5. Verify an allocated/released/started job remains frozen.
6. Cancel/archive the test records through the documented UAT cleanup flow.

### [P2][AWS] Complete the account-level control-plane audit

Application and host controls were verified. The available role cannot certify account-level IAM policy, MFA enforcement, CloudTrail, registrar security, billing alarms, Lightsail firewall governance, or automated Lightsail snapshots. An AWS account administrator should review those controls and attach evidence to this report.

## Final conclusion

The incident was not one isolated frontend error. It combined historical-name drift, clone-oriented edit behavior, suppressed propagation failures, stale downstream snapshots, public legacy mockup exposure, and several broader fail-open mutation paths. Those causes are now addressed with stable aliases, explicit revision creation, user-facing name privacy, transactional propagation, immutable released execution, fail-closed validation, rollback-safe business mutations, compatibility-route gates, removal of public legacy mockups, long-session authentication coverage, hardened containers, dependency gates, encrypted backups, and an actual restore drill.

The deployed AWS application is healthy and production-ready at the application/runtime level, with verified core-release manifest parity, current frontend privacy-gate source parity, and complete automated release evidence. Full operational closure requires the four owner-controlled actions above: restore GitHub authentication and push, add off-host backup IAM/storage, provision a dedicated production UAT identity, and complete the AWS account-level review.

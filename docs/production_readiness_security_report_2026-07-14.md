# Production readiness and security report — 14 July 2026

## Executive summary

The live ERP is healthy after four production fixes: planner control-hub work is bounded to prevent request-worker exhaustion, scheduled report archives now use persistent media storage instead of the read-only application directory, work-center queue enrichment now records artwork/material lookup failures instead of swallowing them, and execution-context fallbacks now emit job-specific warnings instead of disappearing silently. The follow-up release adds diagnostics to route refresh, planner row degradation, dispatch-board summaries, stale-reservation healing, stock-form resolution, and automatic roll assignment, while preserving all business rules. The release also includes critical-flow fallback diagnostics across the application/configuration Python surface and a CI AST guard against new bare exception-swallowing handlers. The report-dispatch task completed all five daily packs successfully after deployment. No Critical or High application security finding was identified in the reviewed Django/Next.js/Docker scope.

Runtime verification was performed on the AWS host and public endpoint on 14 July 2026 IST. The deployed backend report-storage, queue-enrichment, and execution-context source hashes matched the committed source. The application-code release is `8483fca` on branch `codex/planner-sales-latest-20260629`; it is pushed and deployed to AWS.

## Follow-up observability hardening

- Route refresh now records template/step/job identifiers when a sequence cannot be parsed, a strict route dispatch is skipped, or no work center resolves; the existing safe exclusion behavior is unchanged (`apps/templates/services.py`).
- Planner sales/stock rows, dispatch-board cards, stale-reservation healing, output stock-form resolution, and automatic roll assignment now emit warning-level, identifier-rich diagnostics before their existing recoverable fallback/continue behavior (`apps/production/views_planner.py`, `apps/production/views.py`, `apps/production/services/roll_allocation_service.py`, `apps/production/services/services_execution.py`).
- Additional business-flow fallbacks now emit the same diagnostics for terminal-location/density resolution, in-house packaging/POD demand and stock lookups, packing tare/quantity calculations, artwork compatibility size loading, inventory ink-floor theory rows, delivery-challan numbering, and order-line stock-form lookup (`apps/production/services/services_execution.py`, `apps/production/services/in_house_demand_service.py`, `apps/production/services/packing_service.py`, `apps/artwork/compatibility.py`, `apps/inventory/services/ink_floor.py`, `apps/production/services/dispatch_service.py`, `apps/sales/services/order_service.py`).
- The change is logging-only: no order, template, route, allocation, inventory, or release decision was relaxed.
- Current full-backend verification: 907/907 tests passed; `scripts/check_no_silent_failures.py` passed across 778 application/configuration modules; all nine deployed module hashes match the local committed source and the running backend image.

## Fixed production defect

### FIX-001 — Scheduled report dispatch failed continuously

- Severity: High availability impact; resolved.
- Location: `apps/analytics/report_delivery.py:147-151`.
- Evidence: the worker repeatedly raised `PermissionError: [Errno 13] Permission denied: '/app/.runtime'` while persisting report artifacts.
- Fix: archives now use `MEDIA_ROOT/report-distributions`, the shared persistent and permissioned storage boundary. Backend, worker, and scheduler all mount it (`deploy/aws/docker-compose.yml:49-52`, `76-79`, `110-113`).
- Verification: report-delivery tests passed 11/11; the full backend suite passed 907/907; post-deploy, all five scheduled report packs succeeded and production failed-report count was `0`.

## Verified security controls

- Hosted Django settings force `DEBUG=False`, use explicit hosts/origins, secure cookies, HSTS, clickjacking protection, and fail closed when required production settings are missing (`config/settings.py:102-119`, `172-181`, `307-340`, `442-465`).
- Authentication cookies are HttpOnly, secure in hosted environments, CSRF-protected for login, refresh, and logout, and auth endpoints are throttled (`apps/users/views.py:165-340`).
- Public endpoints found during review are deliberately limited to health and the browser authentication/CSRF handshake; privileged ERP APIs retain authenticated RBAC.
- The Next.js middleware applies a nonce-based CSP with `strict-dynamic`, frame denial, `nosniff`, referrer, permissions, and cross-origin opener policies (`frontend_v2/src/middleware.ts:15-60`). The public site returned these headers over HTTPS.
- Backend, worker, and scheduler drop capabilities and set `no-new-privileges`; backend and frontend ports are loopback-only (`deploy/aws/docker-compose.yml:28-113`).
- Work-center queue enrichment logs warning-level evidence with job identifiers when artwork or material-readiness lookups fail (`apps/production/services/queue_enrichment.py:25-210`); the authoritative machine-release gate remains unchanged.
- Production execution context logs job/requirement-specific warnings when material, grade, width, density, or requirement-recalculation fallbacks are taken (`apps/production/services/services_execution.py:821-5021`, `6571-6605`); these diagnostics do not change fallback behavior or business rules.
- Product naming, route metadata, stock validation, planner filters/labels, in-house demand, and roll-allocation fallback paths now emit structured warning/debug evidence rather than silently swallowing lookup or parsing failures. `scripts/check_no_silent_failures.py` scans these eight critical modules and fails the release if a bare `except: pass` handler is introduced.
- Production versions were verified as Django `6.0.7`, Pillow `12.3.0`, and pip `26.1.2`.
- The Django/Next.js/React security-best-practices review found no Critical or High application finding in the inspected scope: hosted settings fail closed on missing secrets/hosts, production uses Gunicorn and `next start`, the frontend review found no raw HTML/DOM injection sinks in `frontend_v2/src`, and the only `NEXT_PUBLIC_*` values are public API/environment/Sentry identifiers. The tracked `.env` files are examples only.

## Verification coverage

- Full Django regression suite: 907/907 passed.
- Production execution, roll allocation, dispatch, output-cap, packaging, and partial-fulfilment suite after the diagnostics patch: 54/54 passed.
- Focused Product Master, snapshot-revision, route-dispatch, planner-queue, in-house-demand, and route-graph suite after the diagnostics patch: 120/120 passed.
- Full `run_tagged_acceptance --suite full_go_live --cleanup-after` proof passed 30/30 scenarios, including roll conservation, POD formula, WIP gating, artwork/planner release gates, ROTO approval, route-parent navigation, and UI badge deduplication. The cleanup recheck left zero acceptance-only rolls, materials, POD variants, templates, work centers, or audit lines.
- Targeted Product Master, snapshot-revision, route-dispatch, and planner-queue suite: 65/65 passed; queue-enrichment/route suite after the observability patch: 33/33 passed.
- Frontend lint, route validation (79 sidebar and 141 resolver routes), user-facing version privacy, and optimized Next.js build passed.
- Release workflow now pins backend CI to Python 3.12 (matching production) and includes the user-facing version-privacy check.
- Frontend production dependency audit found no high-severity vulnerability.
- AWS `manage.py check --deploy`, service health checks, public `/master/products`, and `/api/health/ready/` passed.
- Post-deployment worker logs show a successful report-dispatch cycle and no matching traceback, permission, timeout, or unexpected-task error.
- Post-deployment local/remote source hashes matched for all 27 changed Python sources in release `5cc59a6` (including `apps/production/services/services_execution.py` at `a4391c9f878899f0d43864d552b63a12fd5055887d5b3440517d7aac71cbad4a`); backend, worker, and beat were recreated from the new image and remained healthy. The public live and readiness probes returned HTTP 200, and the post-restart worker log window contained no permission, traceback, timeout, unexpected-task, or error matches.
- Follow-up release `5755617` was rebuilt from the committed source after a pre-deploy PostgreSQL backup (`/opt/tpp-erp/backups/daily/tpp-erp-db-20260714-023803+0530.sql.gz`); `manage.py check --deploy` passed, migrations were current, backend/frontend/worker/beat were force-recreated, and all six runtime containers remained healthy. The five changed Python hashes matched on workstation, host checkout, and the running backend image; public live/readiness/products/root probes returned HTTP 200 and the post-restart backend/worker/beat log window contained no traceback, error, timeout, or exception matches.
- Release `8483fca` was rebuilt from the committed source after a pre-deploy PostgreSQL backup (`/opt/tpp-erp/backups/daily/tpp-erp-db-20260714-030115+0530.sql.gz`); `manage.py check --deploy` passed, migrations were current, backend/frontend/worker/beat were force-recreated, and all six runtime containers remained healthy. Nine changed Python hashes matched on workstation, host checkout, and the running backend image; public live/readiness/products/root probes returned HTTP 200, HTTPS returned CSP/HSTS/nosniff/frame-denial headers, and the post-restart backend/worker/beat log window contained no traceback, error, timeout, or exception matches.
- The CI workflow now runs the silent-failure AST guard, pins backend checks to Python 3.12, and enforces the user-facing version-privacy test.
- The repository-wide guard now scans 778 `apps/` and `config/` Python modules and passed with no bare exception-swallowing handlers.
- The encrypted managed-backup restore drill passed inside the production backend container against an isolated temporary PostgreSQL database; cleanup completed successfully. Verified command: `cd /opt/tpp-erp/app && sudo docker compose -f deploy/aws/docker-compose.yml run --rm backend /app/deploy/aws/restore-drill.sh`. The script intentionally reads `/var/backups/tpp-erp/managed`, which is the container mount for the host's `/opt/tpp-erp/backups/managed`; invoking the script directly on the host without `BACKUP_LOCAL_DIR` is not a valid production drill.
- A live production dry run of `python manage.py repair_master_revision_integrity` returned zero unresolved or planned film aliases, Product Master repairs, route repairs, template repairs, legacy redirects, stale-order rebases, and open-order revisions. The screenshot-era `PP-TUBING` reference is backed by the active `PP-TUBING` alias to canonical `PP-MONO`.
- A live platform-ops query returned recent `SUCCEEDED` encrypted local backup records, recent `SUCCEEDED` restore-drill records with `smoke_test_passed=true`, and zero unresolved operational alerts.

## Operational controls not proven from available access

### OP-001 — AWS account-level alerting, WAF, and off-host backup policy

- Severity: Medium operational assurance gap, not an application vulnerability.
- Signed-in AWS console verification found Lightsail automatic snapshots disabled, zero CloudWatch alarms, zero Mumbai WAF web ACLs, zero S3 buckets, and no load balancer or distribution attached to the production instance. The live container also exposes no `BACKUP_S3_*` configuration.
- The backup timer is enabled/active, encrypted managed backups exist, and the local encrypted restore drill passes. Required operational decisions remain: approve billable daily Lightsail snapshots, define CloudWatch thresholds/recipients, choose WAF/edge architecture, configure an encrypted off-host backup target, and restrict SSH from Any IPv4/IPv6 to an approved administration source range.

### OP-003 — Broad SSH exposure

- Severity: Medium security hardening gap, not an application-code vulnerability.
- The host SSH service is now key-only with root login disabled, X11 forwarding disabled, four-attempt throttling, and idle-session keepalives (`deploy/aws/sshd-hardening.conf`); `sshd -t`, reload, a fresh key-authenticated SSH session, and the public readiness probe all passed after application.
- Lightsail IPv4 and IPv6 firewall rules still allow TCP/22 from any address. Narrowing this safely requires an approved administrator IP/CIDR or a deliberate VPN/SSM access design; changing it blindly could lock out the operations team.

### OP-002 — Local developer virtual environment is stale

- Severity: Low; not deployed.
- The local Python 3.11 audit scanned Django 5.2.15/Pillow 12.2.0, while production runs Python 3.12 with Django 6.0.7/Pillow 12.3.0.
- The GitHub release gate now runs Python 3.12 to match the locked production requirements; recreate the local development environment with Python 3.12 before the next local dependency audit.

## Conclusion

The reviewed application and deployed runtime are ready for normal operation. No complex system can be guaranteed never to fail; the relevant failure paths now have bounded planner work, durable report storage, regression coverage, readiness checks, explicit queue-enrichment and execution-context warnings, a verified live scheduler cycle, and a passing isolated restore drill. Closing OP-001 still requires AWS-account policy decisions and off-host backup configuration rather than an application-code change.

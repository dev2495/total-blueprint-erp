# Production readiness and security report — 14 July 2026

## Executive summary

The live ERP is healthy after four production fixes: planner control-hub work is bounded to prevent request-worker exhaustion, scheduled report archives now use persistent media storage instead of the read-only application directory, work-center queue enrichment now records artwork/material lookup failures instead of swallowing them, and execution-context fallbacks now emit job-specific warnings instead of disappearing silently. The report-dispatch task completed all five daily packs successfully after deployment. No Critical or High application security finding was identified in the reviewed Django/Next.js/Docker scope.

Runtime verification was performed on the AWS host and public endpoint on 14 July 2026 IST. The deployed backend report-storage, queue-enrichment, and execution-context source hashes matched the committed source. The application-code release is `68c6eb0ae3fd4af907da806007186023b1a8eddf`.

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
- Production versions were verified as Django `6.0.7`, Pillow `12.3.0`, and pip `26.1.2`.

## Verification coverage

- Full Django regression suite: 907/907 passed.
- Production execution, roll allocation, dispatch, output-cap, packaging, and partial-fulfilment suite after the diagnostics patch: 54/54 passed.
- Targeted Product Master, snapshot-revision, route-dispatch, and planner-queue suite: 65/65 passed; queue-enrichment/route suite after the observability patch: 33/33 passed.
- Frontend lint, route validation (79 sidebar and 141 resolver routes), user-facing version privacy, and optimized Next.js build passed.
- Frontend production dependency audit found no high-severity vulnerability.
- AWS `manage.py check --deploy`, service health checks, public `/master/products`, and `/api/health/ready/` passed.
- Post-deployment worker logs show a successful report-dispatch cycle and no matching traceback, permission, timeout, or unexpected-task error.
- Post-deployment local/remote source hash for `apps/production/services/services_execution.py` matched (`a4391c9f878899f0d43864d552b63a12fd5055887d5b3440517d7aac71cbad4a`); backend, worker, and beat were recreated from that image and remained healthy.
- The encrypted managed-backup restore drill passed inside the production backend container against an isolated temporary PostgreSQL database; cleanup completed successfully.

## Operational controls not proven from available access

### OP-001 — AWS account-level alerting, WAF, and off-host backup policy

- Severity: Medium operational assurance gap, not an application vulnerability.
- Signed-in AWS console verification found Lightsail automatic snapshots disabled, zero CloudWatch alarms, zero Mumbai WAF web ACLs, zero S3 buckets, and no load balancer or distribution attached to the production instance. The live container also exposes no `BACKUP_S3_*` configuration.
- The backup timer is enabled/active, encrypted managed backups exist, and the local encrypted restore drill passes. Required operational decisions remain: approve billable daily Lightsail snapshots, define CloudWatch thresholds/recipients, choose WAF/edge architecture, configure an encrypted off-host backup target, and restrict SSH from Any IPv4/IPv6 to an approved administration source range.

### OP-003 — Broad SSH exposure

- Severity: Medium security hardening gap, not an application-code vulnerability.
- Lightsail IPv4 and IPv6 firewall rules currently allow TCP/22 from any address. Narrowing this safely requires an approved administrator IP/CIDR or a deliberate VPN/SSM access design; changing it blindly could lock out the operations team.

### OP-002 — Local developer virtual environment is stale

- Severity: Low; not deployed.
- The local Python 3.11 audit scanned Django 5.2.15/Pillow 12.2.0, while production runs Python 3.12 with Django 6.0.7/Pillow 12.3.0.
- Recreate the local development environment with Python 3.12 from locked requirements before the next local dependency audit.

## Conclusion

The reviewed application and deployed runtime are ready for normal operation. No complex system can be guaranteed never to fail; the relevant failure paths now have bounded planner work, durable report storage, regression coverage, readiness checks, explicit queue-enrichment and execution-context warnings, a verified live scheduler cycle, and a passing isolated restore drill. Closing OP-001 still requires AWS-account policy decisions and off-host backup configuration rather than an application-code change.

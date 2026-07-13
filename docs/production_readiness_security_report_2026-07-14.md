# Production readiness and security report — 14 July 2026

## Executive summary

The live ERP is healthy after two production fixes: planner control-hub work is bounded to prevent request-worker exhaustion, and scheduled report archives now use persistent media storage instead of the read-only application directory. The report-dispatch task completed all five daily packs successfully after deployment. No Critical or High application security finding was identified in the reviewed Django/Next.js/Docker scope.

Runtime verification was performed on the AWS host and public endpoint on 14 July 2026 IST. The deployed backend report-storage source hash matched the committed source. The application-code release is `fec9f5eb317362b701ce9ec88f20faa8c04820de`.

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
- Production versions were verified as Django `6.0.7`, Pillow `12.3.0`, and pip `26.1.2`.

## Verification coverage

- Full Django regression suite: 907/907 passed.
- Frontend lint, route validation (79 sidebar and 141 resolver routes), user-facing version privacy, and optimized Next.js build passed.
- Frontend production dependency audit found no high-severity vulnerability.
- AWS `manage.py check --deploy`, service health checks, public `/master/products`, and `/api/health/ready/` passed.
- Post-deployment worker logs show a successful report-dispatch cycle and no matching traceback, permission, timeout, or unexpected-task error.

## Operational controls not proven from available access

### OP-001 — AWS account-level alerting, WAF, and off-host backup policy

- Severity: Medium operational assurance gap, not an application vulnerability.
- Server-level access proves container health and in-app backup/readiness checks, but cannot prove CloudWatch alarm routing, AWS WAF/edge rules, or encrypted off-host backup retention.
- Required verification: review those controls in the AWS account and perform one documented restore from an off-host backup into an isolated database.

### OP-002 — Local developer virtual environment is stale

- Severity: Low; not deployed.
- The local Python 3.11 audit scanned Django 5.2.15/Pillow 12.2.0, while production runs Python 3.12 with Django 6.0.7/Pillow 12.3.0.
- Recreate the local development environment with Python 3.12 from locked requirements before the next local dependency audit.

## Conclusion

The reviewed application and deployed runtime are ready for normal operation. No complex system can be guaranteed never to fail; the relevant failure paths now have bounded planner work, durable report storage, regression coverage, readiness checks, and a verified live scheduler cycle. Closing OP-001 requires AWS-account access rather than an application-code change.

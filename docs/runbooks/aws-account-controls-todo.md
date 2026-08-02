# AWS Account Controls — Deferred TODO

Recorded 14 July 2026 after the application/runtime release. These items do not block normal authenticated ordering, Product Master editing, template routing, planner work, or user-facing version privacy today. They do reduce recovery and security assurance during an infrastructure incident, so the system must not be described as fully account-hardened until they are closed.

| ID | Deferred control | Current evidence | User impact if deferred | Required decision |
| --- | --- | --- | --- | --- |
| OPS-001 | Restrict Lightsail TCP/22 from Any IPv4/IPv6 | SSH service is key-only, root-disabled, X11-disabled; AWS firewall remains broad | No normal order-flow impact; increased unauthorized-access exposure | Approved administrator CIDR, VPN, or SSM path |
| OPS-002 | Configure encrypted off-host backup storage | Local encrypted backups and isolated restore drill pass; no `BACKUP_S3_*` target is configured | No normal order-flow impact; a host loss could reduce recovery options | S3-compatible bucket/region and credential or instance-role design |
| OPS-003 | Enable automatic Lightsail snapshots | Automatic snapshots were not enabled during the signed-in review | No normal order-flow impact; slower recovery after host/storage failure | Approval for the recurring AWS charge |
| OPS-004 | Add CloudWatch alarms and notification routing | No production CloudWatch alarms were observed | No normal order-flow impact; outages may be detected later | Thresholds and SNS/email/on-call recipient |
| OPS-005 | Choose WAF/edge protection | No Mumbai WAF ACL or load balancer/distribution is attached | No normal order-flow impact; less edge/DDoS protection | CloudFront/WAF architecture and budget |
| DEV-001 | Recreate the local development environment on Python 3.12 | CI and production use Python 3.12; local audit environment is older | No production-user impact | Schedule local toolchain refresh |

## Reopening rule

Reopen this checklist before increasing traffic, changing the AWS host, rotating credentials, or claiming full operational production hardening. Application/runtime readiness is tracked separately in `production_readiness_security_report_2026-07-14.md`.

# Secrets Rotation Procedure

## Inventory
- `SECRET_KEY`
- DB credentials
- Redis credentials
- `RESEND_API_KEY`
- backup storage credentials (`BACKUP_S3_*`)
- `BACKUP_ENCRYPTION_KEY`
- `SENTRY_DSN`

## Cadence
- standard rotation: every 90 days
- emergency rotation: immediately on suspected exposure

## Procedure
1. Generate new secret value.
2. Set secret in staging services first.
3. Run staging smoke:
   - auth login
   - health endpoints
   - notification email send
   - backup task trigger
4. Set secret in production.
5. Restart affected services.
6. Verify production smoke and audit logs.
7. Revoke old credentials.

## Required evidence
- who rotated
- when rotated
- services affected
- smoke result links/screenshots/log references

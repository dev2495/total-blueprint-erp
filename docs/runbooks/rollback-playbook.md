# Rollback Playbook

## Scope
Applies to backend, frontend, worker, and beat services deployed via Render.

## Rollback decision triggers
- P0 flow break (sales -> planning -> production -> dispatch)
- sustained 5xx spike
- queue dead-letter growth
- backup task failures after release
- critical RBAC visibility regression

## Rollback steps
1. Identify last known good release in Render for each impacted service.
2. Roll back in this order:
   1. `frontend-web`
   2. `backend-api`
   3. `celery-worker`
   4. `celery-beat`
3. If migration was destructive/incompatible:
   - initiate DB restore from latest successful backup
4. Validate:
   - `/api/health/live/` and `/api/health/ready/`
   - queue workers online
   - notifications can be created and read
   - role entitlements endpoint returns expected permissions

## GitHub release gate
- keep production deployment job behind GitHub Environment approval.
- never auto-promote from failing staging signal.

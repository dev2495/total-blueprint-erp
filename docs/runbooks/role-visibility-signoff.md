# Role Visibility Signoff Runbook

## Canonical roles
- `OWNER`
- `ADMIN`
- `SALES`
- `ENGINEERING`
- `PLANNER`
- `WORK_CENTER_MANAGER`
- `OPERATOR`
- `STORE`
- `DISPATCH`

## Goal
Enforce deny-by-default access and ensure each role-module-action tuple is department-approved before go-live.

## Signoff flow
1. Export baseline matrix:
   - `GET /api/users/roles/matrix/export`
2. Bootstrap pending signoff rows from permissions:
   - `POST /api/users/roles/visibility/bootstrap-signoffs`
3. Review per department owner.
4. Persist signoff tuples:
   - `POST /api/users/notifications/role-signoffs/upsert`
5. Revalidate readiness:
   - `GET /api/users/roles/visibility/revalidate`
6. Validate effective user entitlements:
   - current user: `GET /api/users/users/entitlements/validate`
   - specific user: `GET /api/users/users/{id}/entitlements/validate`

## Production controls
- `STRICT_RBAC=True`
- `ALLOW_ROLE_OVERRIDE=False`
- all denials + overrides audited in `users_permission_audit_log`

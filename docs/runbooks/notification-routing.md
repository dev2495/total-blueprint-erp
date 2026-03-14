# Notification Routing and Delivery Runbook

## Event coverage (P0)
- `sales.confirmed`
- `sales.planning_required`
- `production.job_released`
- `production.machine_ready`
- `production.fg_ready`
- `logistics.dispatch_ready`
- `production.delayed`
- `inventory.low_stock`

## Channels
- `IN_APP` (persisted immediately)
- `EMAIL` (queued via Celery with retry/backoff)

## Admin APIs
- list rules: `GET /api/users/notifications/rules`
- upsert rule: `POST /api/users/notifications/rules/upsert`
- view audit: `GET /api/users/notifications/permission-audit`

## Retry semantics
- Email task retry uses exponential backoff.
- Channel attempt records are stored in `users_notification_delivery_attempts`.
- Delivery state is reflected per notification in `delivery_state`.

## Dead-letter handling
1. Query failed attempts (`status = FAILED`).
2. Resolve root cause (provider auth/network/template).
3. Requeue by creating a new attempt or replaying event with a new idempotency key.

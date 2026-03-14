# Render Production Checklist

Use this with `.env.production.example` when creating or updating the hosted environment.

## Required environment

Set these explicitly for the backend, worker, and beat services:

- `DJANGO_ENV=production`
- `DEBUG=False`
- `SECRET_KEY`
- `ALLOWED_HOSTS`
- `CORS_ALLOWED_ORIGINS`
- `CSRF_TRUSTED_ORIGINS`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_HOST`
- `DB_PORT`
- `REDIS_URL`
- `CELERY_BROKER_URL`
- `CELERY_RESULT_BACKEND`
- `STRICT_RBAC=True`
- `ALLOW_ROLE_OVERRIDE=False`
- `SECURE_SSL_REDIRECT=True`
- `SESSION_COOKIE_SECURE=True`
- `CSRF_COOKIE_SECURE=True`
- `SECURE_HSTS_SECONDS=31536000`
- `SECURE_HSTS_INCLUDE_SUBDOMAINS=True`
- `SECURE_HSTS_PRELOAD=True`
- `JWT_COOKIE_SECURE=True`
- `JWT_COOKIE_SAMESITE=None`
- `JWT_COOKIE_DOMAIN=.totalpolyprint.com`

Optional, but expected in hosted production:

- `EMAIL_PROVIDER`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `BACKUP_ENCRYPTION_KEY`
- `BACKUP_S3_BUCKET`
- `BACKUP_S3_ENDPOINT`
- `BACKUP_S3_REGION`
- `BACKUP_S3_ACCESS_KEY`
- `BACKUP_S3_SECRET_KEY`
- `SENTRY_DSN`

## Release gate

Run these in staging with production-like env values before go-live:

1. `venv_311/bin/python manage.py migrate --noinput`
2. `venv_311/bin/python manage.py check --deploy`
3. `venv_311/bin/python manage.py test --noinput`
4. `venv_311/bin/python manage.py run_tagged_acceptance --noinput`
5. `cd frontend_v2 && npm run lint`
6. `cd frontend_v2 && npm run typecheck`
7. `cd frontend_v2 && npm run build`
8. `cd frontend_v2 && npm run e2e:ui`

## Report/bootstrap tasks

Run once after deployment:

1. `venv_311/bin/python manage.py bootstrap_official_report_scope`
2. `venv_311/bin/python manage.py seed_notification_baseline`
3. `venv_311/bin/python manage.py bootstrap_report_smoke`

If email is intentionally disabled, the report smoke should still save artifacts and record `SKIPPED_EMAIL` audit status.

## Manual signoff checks

- Auth works with secure cookies from the hosted frontend domain.
- Planner, WCM, and operator pages load without notification polling crashes.
- Stock-standing PDF and detail workbook download from the analytics/system report surfaces.
- Official report scope excludes demo/test plants.

# Render Deployment Guide

## 1) Repository bootstrap

This project is intended to be deployed from the repository root with [`render.yaml`](../render.yaml) as the source of truth.

1. Initialize Git in this folder with default branch `main`.
2. Use the curated root `.gitignore`; do not commit the live `.env`, logs, PID files, local scratch scripts, or build output.
3. Create a private GitHub repository and push `main`.
4. Treat `main` as the Render deployment branch.

Use a branch flow that keeps updates simple:
- create short-lived feature branches from `main`
- merge back into `main`
- let Render pick up the merged commit from GitHub

## 2) Blueprint deployment shape

[`render.yaml`](../render.yaml) provisions a fresh multi-environment setup:
- 2 PostgreSQL databases
- 2 Redis Key Value instances
- 8 services total across staging and production:
  - backend API
  - frontend web
  - celery worker
  - celery beat

Deployment policy:
- staging services auto-deploy from `main`
- production services require manual deploy approval from the latest `main`

## 3) Create services from Blueprint

Prerequisite: the repository must already be pushed to GitHub before Render can consume `render.yaml`.

1. In the Render dashboard, choose **Blueprint** deployment.
2. Select this GitHub repository.
3. Use the repo-root [`render.yaml`](../render.yaml).
4. Review the resource list and create the fresh staging + production stack.

## 4) Configure mandatory secrets

Set these in Render; do not commit them to Git:
- `SECRET_KEY` for each environment
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `BACKUP_ENCRYPTION_KEY`
- `BACKUP_S3_BUCKET`
- `BACKUP_S3_ENDPOINT`
- `BACKUP_S3_REGION`
- `BACKUP_S3_ACCESS_KEY`
- `BACKUP_S3_SECRET_KEY`
- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN` for frontend services

Use the same `SECRET_KEY` value across `backend-api`, `celery-worker`, and `celery-beat` inside the same environment.

Only `*.example` env files belong in the repo. The live `.env` remains local-only.

## 5) Post-deploy bootstrap

1. Run migrations:
   - `python manage.py migrate --noinput`
2. Sync canonical role permissions:
   - `python manage.py shell -c "from apps.users.permission_service import PermissionService; print(PermissionService.sync_default_permissions_from_matrix())"`
3. Validate deploy profile:
   - `python manage.py check --deploy`

## 6) Health checks

Workers:
- celery worker logs must show `celery@... ready`
- beat logs must show the expected scheduled entries

Smoke checks:
- `GET /api/health/live/` returns `200`
- `GET /api/health/ready/` returns `200` or a degraded `503` with dependency detail
- `GET /api/ops/metrics/summary` as admin returns an operational payload

## 7) Ongoing updates

Normal update flow:
1. push a feature branch
2. merge into `main`
3. confirm staging auto-deploy completes
4. manually promote the production services from the same commit lineage

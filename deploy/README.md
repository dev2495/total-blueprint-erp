# Render Deployment Guide

Use this document for operator steps. For the client-shareable overview and budget pack, start with:

- [Project Overview](../README.md)
- [Client Deployment And Costing Guide](../docs/client-deployment-and-costing.md)

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

Recommended governance:
- keep the GitHub repo private
- limit collaborators to the owner team only
- require the `backend-quality` and `frontend-quality` checks before production promotion when GitHub plan support allows branch protection on the private repo

## 2) Blueprint deployment shape

[`render.yaml`](../render.yaml) now provisions the recommended `$150` production-only setup:
- 1 PostgreSQL database
- 1 Redis Key Value instance
- 4 application services:
  - backend API
  - frontend web
  - celery worker
  - celery beat

Deployment policy:
- CI remains the gate through `backend-quality` and `frontend-quality`
- production deploys stay controlled with `autoDeployTrigger: off`
- the optional always-on staging environment belongs to the `$200` plan described in the client cost guide, not the default Blueprint

GitHub Actions are quality gates only:
- `backend-quality`
- `frontend-quality`

Render is the only deployment controller. This repo does not use GitHub deploy hooks.

## 3) Create services from Blueprint

Prerequisite: the repository must already be pushed to GitHub before Render can consume `render.yaml`.

1. In the Render dashboard, choose **Blueprint** deployment.
2. Select this GitHub repository.
3. Use the repo-root [`render.yaml`](../render.yaml).
4. Review the resource list and create the default production stack.
5. Configure the required secrets in Render before validating the services.

Database note:
- production targets a current Render PostgreSQL plan name with `20 GB` disk
- the default Blueprint does not include staging or HA because it is aligned to the `$150` recommendation
- if you later choose the `$200` option, add a separate starter-sized staging stack as described in the client cost guide

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
3. confirm GitHub checks pass
4. deploy production from the approved `main` commit

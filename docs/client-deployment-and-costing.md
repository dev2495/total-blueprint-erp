# Client Deployment And Costing Guide

This document is the client-facing deployment, ownership, and cost breakdown for Total Blueprint ERP. It is based on the current repository, the current `render.yaml` topology, and official vendor pricing checked on **March 15, 2026**.

## 1. Recommended Operating Model

The recommended live posture for this project is:

- one private GitHub repository
- one Render workspace shared only with you and the client
- one always-on staging environment
- one always-on production environment
- one high-availability production PostgreSQL database
- scheduled offsite backups plus restore drills

This keeps day-to-day work safe:

- staging receives the first deployment after CI passes
- production is promoted manually from the same `main` commit
- the database has both Render-managed recovery and app-managed offsite backup coverage

## 2. Environment Topology

| Environment | Services | Database | Redis | Deploy policy |
| --- | --- | --- | --- | --- |
| Production | Backend API, frontend web, Celery worker, Celery beat | `erp-postgres-prod` | `erp-redis-prod` | Manual promotion from successful `main` commits |
| Staging | Backend API, frontend web, Celery worker, Celery beat | `erp-postgres-staging` | `erp-redis-staging` | Auto-deploy after `backend-quality` and `frontend-quality` pass |

## 3. Service Inventory

| Service | Purpose | Current plan target |
| --- | --- | --- |
| Backend API | Main business logic, auth, masters, production, inventory, analytics APIs | Production `standard`, staging `starter` |
| Frontend web | Browser UI for owner, planner, store, dispatch, sales, engineering, admin | Production `starter`, staging `starter` |
| Celery worker | Background jobs, report generation, queue processing, backup tasks | Production `standard`, staging `starter` |
| Celery beat | Scheduler for timed operations | Production `starter`, staging `starter` |
| PostgreSQL | Primary transactional data store | Production `pro-4gb` with HA, staging `basic-1gb` |
| Redis / Key Value | Queue broker, results backend, async coordination | Production `standard`, staging `starter` |

## 4. Backup And Disaster Recovery Design

The repo already contains a layered recovery approach:

| Layer | What it does | Repo behavior today |
| --- | --- | --- |
| Render PostgreSQL recovery | Managed snapshots and point-in-time restore | Covered by Render-managed database service |
| App-level database dump | Extra logical dump outside the managed DB runtime | Runs every 4 hours through Celery beat |
| Encryption | Protects logical backup artifacts at rest | Optional AES-256 via `BACKUP_ENCRYPTION_KEY` |
| Offsite copy | Pushes dumps outside the app runtime | Uploads to S3-compatible object storage when configured |
| Retention | Removes old backup artifacts | Daily prune job |
| Restore drill | Tests the recovery path | Weekly restore-drill job |
| Inventory snapshot | Preserves operational inventory state | Nightly snapshot job |

### Recovery Notes

- Render-managed recovery is the fastest path for point-in-time database rollback.
- The app-managed dump gives you a second recovery lane that is independent of the live database instance.
- Offsite object storage is recommended for production because local runtime storage should not be treated as durable backup storage.

### Render Backup Facts Used Here

- Managed PostgreSQL includes point-in-time recovery.
- Snapshot retention is 7 days on Basic and Pro plans.
- High availability on Render adds a standby instance billed like a second matching database instance.

## 5. Monitoring And Operations

| Area | Current behavior |
| --- | --- |
| Health probes | `/api/health/live/` for liveness, `/api/health/ready/` for readiness |
| Readiness checks | Database and Redis always required; Celery is also required in production |
| Background jobs | Celery worker and Celery beat are separate always-on services |
| Email dispatch | Scheduled report packs use Resend |
| Error monitoring | Sentry DSNs are already part of the deployment contract |
| CI gate | GitHub Actions: `backend-quality` and `frontend-quality` |

## 6. Access, Ownership, And Governance

| Topic | Recommended rule |
| --- | --- |
| Repository visibility | Keep GitHub private |
| Repository collaborators | Limit to you and the client |
| Deployment branch | `main` |
| Staging policy | Auto-deploy after both required checks pass |
| Production policy | Deploy manually from successful `main` commits only |
| Render workspace | Professional workspace with two paid seats |

### Branch Protection Reality

The current repository is a **private personal GitHub repository**. GitHub returned a `403` when checking branch protection on this private repo, which means protected-branch enforcement is not available on the current GitHub plan for this repository.

Use one of these if you want enforced protected branches:

| Option | When to use it | Cost signal |
| --- | --- | --- |
| GitHub Pro on the owner account | Keep the repo under a personal private account | `$4/month` for the owner account |
| GitHub Team org | Move the repo into an organization and manage both users there | `$4/user/month` |

If you do not upgrade GitHub governance, the repo is still deployable, but check enforcement remains process-based rather than policy-enforced.

## 7. Capacity Guidance

This stack should be described as a **small-to-mid plant always-on cloud deployment**, not as an infinite-scale SaaS cluster.

Current runtime shape:

- production backend starts with `gunicorn` and `3` web workers
- staging backend starts with `2` web workers
- production Celery worker starts with concurrency `2`
- staging Celery worker starts with concurrency `1`
- one dedicated beat scheduler runs per environment

This is suitable for concurrent owner/admin/planner/store/dispatch/sales/engineering use, but scaling decisions should be driven by signals, not promises.

### Upgrade Triggers

Scale up when any of these become normal operating behavior:

- rising API latency under normal daytime usage
- report or queue backlog growing faster than the worker can drain it
- PostgreSQL CPU, RAM, or storage pressure staying elevated
- Redis saturation or queue time increasing during shift changes
- sustained spikes in background jobs such as reporting, backup, or heavy analytics workloads

## 8. Exact Cost Tables As Of March 15, 2026

Pricing sources used:

- [Render pricing](https://render.com/pricing)
- [Render PostgreSQL docs](https://render.com/docs/postgresql)
- [GitHub pricing](https://github.com/pricing)
- [Resend pricing](https://resend.com/pricing)
- [Sentry pricing](https://sentry.io/pricing/)

Vendor pricing can change. Treat these numbers as the decision baseline for **March 15, 2026** and re-check the linked pricing pages immediately before entering billing details.

### 8.1 Recommended: `Prod + Stage + HA`

This is the recommended deployment for a serious always-on client rollout.

| Item | Qty | Unit price | Monthly subtotal |
| --- | ---: | ---: | ---: |
| Render Professional seats | 2 | $19 | $38 |
| Production backend (`standard`) | 1 | $25 | $25 |
| Production frontend (`starter`) | 1 | $7 | $7 |
| Production Celery worker (`standard`) | 1 | $25 | $25 |
| Production Celery beat (`starter`) | 1 | $7 | $7 |
| Staging backend (`starter`) | 1 | $7 | $7 |
| Staging frontend (`starter`) | 1 | $7 | $7 |
| Staging Celery worker (`starter`) | 1 | $7 | $7 |
| Staging Celery beat (`starter`) | 1 | $7 | $7 |
| Production Redis (`standard`) | 1 | $32 | $32 |
| Staging Redis (`starter`) | 1 | $10 | $10 |
| Production Postgres compute (`pro-4gb`) | 1 | $55 | $55 |
| Production Postgres storage (20 GB) | 20 GB | $0.30/GB | $6 |
| Production HA standby compute (`pro-4gb`) | 1 | $55 | $55 |
| Production HA standby storage (20 GB) | 20 GB | $0.30/GB | $6 |
| Staging Postgres compute (`basic-1gb`) | 1 | $19 | $19 |
| Staging Postgres storage (10 GB) | 10 GB | $0.30/GB | $3 |
| **Render recurring total** |  |  | **$316/month** |

Recommended third-party recurring add-ons:

| Item | Suggested plan | Monthly subtotal |
| --- | --- | ---: |
| Resend | Pro | $20 |
| Sentry | Team | $26 |
| **Typical add-on total** |  | **$46/month** |

Recommended all-in baseline before variable usage:

- **$362/month**

### 8.2 Lean: `Prod + Stage`

This keeps staging live but removes production HA standby.

| Item | Monthly subtotal |
| --- | ---: |
| Render Professional seats | $38 |
| Production app services | $64 |
| Staging app services | $28 |
| Production Redis | $32 |
| Staging Redis | $10 |
| Production Postgres (`pro-4gb`, 20 GB, no HA) | $61 |
| Staging Postgres (`basic-1gb`, 10 GB) | $22 |
| **Render recurring total** | **$255/month** |

With the same suggested third-party stack:

- **$301/month**

### 8.3 Minimum: `Prod Only`

This keeps the current production service shape but removes staging and HA. It is the minimum I would describe as a serious live deployment while still keeping separate backend, worker, beat, Redis, and managed PostgreSQL.

| Item | Monthly subtotal |
| --- | ---: |
| Render Professional seats | $38 |
| Production app services | $64 |
| Production Redis | $32 |
| Production Postgres (`pro-4gb`, 20 GB, no HA) | $61 |
| **Render recurring total** | **$195/month** |

With the same suggested third-party stack:

- **$241/month**

## 9. Variable-Cost Items

These are not fixed every month:

| Variable item | How to think about it |
| --- | --- |
| PostgreSQL storage growth | Billed per GB above the chosen disk size |
| Outbound bandwidth | Render bills over included transfer at `$15 per 100 GB` |
| Offsite backup storage | Depends on your S3-compatible storage provider and retained backup volume |
| Email volume | Depends on how many report packs and transactional emails you send |
| Monitoring volume | Depends on Sentry event volume and retention needs |

## 10. What This Means For The Client

For a stable client-owned rollout, the practical recommendation is:

1. keep the repo private
2. keep only you and the client as collaborators
3. deploy staging and production from the same private repo
4. use high availability on the production database
5. keep app-level encrypted offsite backups enabled
6. treat staging as the proving environment and production as manual-release only

## 11. Repo Readiness Note

This repo becomes fresh-Blueprint-ready after the PostgreSQL entries in [`render.yaml`](../render.yaml) are modernized from legacy database plan names to current Render-supported plans:

- production database: `pro-4gb`, `diskSizeGB: 20`, `highAvailability: true`
- staging database: `basic-1gb`, `diskSizeGB: 10`

That modernization is part of the same repo update as this guide.

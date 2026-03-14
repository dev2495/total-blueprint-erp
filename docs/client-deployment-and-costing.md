# Client Deployment And Costing Guide

This document is the client-facing deployment, ownership, and cost appendix for Total Blueprint ERP. It matches the repo's intended share model and the current recommended Render topology as of **March 15, 2026**.

## 1. Share And Access Model

Recommended access model:

- keep the GitHub repo private
- add the client as a collaborator
- share the repo root link:
  - [github.com/dev2495/total-blueprint-erp](https://github.com/dev2495/total-blueprint-erp)
- keep Render access under the owner team unless direct dashboard access is needed later

This keeps the codebase visible to the client without exposing the project publicly.

## 2. Current Budget Recommendation

The recommended target is the **`$150/month` Render core option**.

Why:

- it keeps production on stronger managed infrastructure
- it avoids paying for an always-on staging environment by default
- it stays comfortably under the requested monthly ceiling
- it is still simpler than buying and operating a private server

## 3. Budget Options

### 3.1 `$100` Option

Production only:

| Service | Plan | Monthly estimate |
| --- | --- | ---: |
| Backend API | `starter` | $7 |
| Frontend web | `starter` | $7 |
| Celery worker | `starter` | $7 |
| Celery beat | `starter` | $7 |
| PostgreSQL | `basic-1gb` + `10 GB` disk | $22 |
| Redis / Key Value | `starter` | $10 |
| **Render core total** |  | **$60/month** |

What this means:

- lowest sensible managed live deployment
- good for lighter concurrency and moderate reporting load
- less headroom for queue spikes, heavy report generation, and higher daytime traffic

### 3.2 `$150` Option: Recommended

Production only:

| Service | Plan | Monthly estimate |
| --- | --- | ---: |
| Backend API | `standard` | $25 |
| Frontend web | `starter` | $7 |
| Celery worker | `standard` | $25 |
| Celery beat | `starter` | $7 |
| PostgreSQL | `pro-4gb` + `20 GB` disk | $61 |
| Redis / Key Value | `starter` | $10 |
| **Render core total** |  | **$135/month** |

Why this is the best fit:

- stronger production API and queue capacity
- stronger production database
- enough room for real daily usage without paying for full-time staging
- leaves about `$15/month` of headroom under the stated budget target

Suggested use of the remaining buffer:

- GitHub Pro governance add-on if needed
- backup storage growth
- small operational cost drift

### 3.3 `$200` Option

Recommended `$150` production stack plus always-on staging:

| Service group | Monthly estimate |
| --- | ---: |
| Recommended production stack | $135 |
| Staging backend `starter` | $7 |
| Staging frontend `starter` | $7 |
| Staging Celery worker `starter` | $7 |
| Staging Celery beat `starter` | $7 |
| Staging PostgreSQL `basic-1gb` + `10 GB` disk | $22 |
| Staging Redis `starter` | $10 |
| **Render core total** | **$195/month** |

What this means:

- production stays strong
- staging is always available for test deploys and UAT
- this is the first tier where permanent staging is practical

## 4. Cost Separation

### Render Core

The three caps above refer to the default managed Render infrastructure only.

### Optional Governance Add-Ons

These are not included in the base caps:

| Add-on | When to use it | Cost signal |
| --- | --- | ---: |
| GitHub Pro | If you want stronger governance on a private personal repo | $4/month |
| Render extra user seats | Only if the client later needs direct Render dashboard access | Add the current Render seat price per user |

### Optional Third-Party Services

These are not included in the base caps:

| Service | How to treat it at launch |
| --- | --- |
| Resend | Start on free tier if volume allows, upgrade only when report/email volume demands it |
| Sentry | Start on free tier if acceptable, upgrade only when monitoring volume or team workflow requires it |
| S3-compatible backup storage | Variable cost based on retained dump volume and provider |

### Variable Growth Costs

| Variable item | Notes |
| --- | --- |
| PostgreSQL storage growth | Billed above the selected disk size |
| Backup storage growth | Depends on offsite retention and provider |
| Outbound bandwidth | Depends on user traffic and downloaded assets/reports |
| Email volume | Depends on report dispatch volume |
| Monitoring volume | Depends on Sentry event volume |

## 5. Service Inventory By Option

| Option | Environments | Services kept live |
| --- | --- | --- |
| `$100` | Production only | Backend, frontend, worker, beat, Postgres, Redis |
| `$150` | Production only | Backend, frontend, worker, beat, Postgres, Redis |
| `$200` | Production + staging | Production and staging each keep backend, frontend, worker, beat, Postgres, Redis |

## 6. Backup And Recovery Design

The application already supports layered recovery:

| Layer | Current behavior |
| --- | --- |
| Render PostgreSQL recovery | Managed snapshots and point-in-time restore |
| App-level DB dump | Runs every 4 hours |
| Backup encryption | Optional AES-256 using `BACKUP_ENCRYPTION_KEY` |
| Offsite copy | Uploads to S3-compatible object storage when configured |
| Retention pruning | Daily |
| Restore drill | Weekly |
| Inventory snapshot | Nightly |

Recommended interpretation by budget:

- `$100`: keep Render recovery enabled and configure offsite backup as soon as the live system stabilizes
- `$150`: enable offsite backup from the start
- `$200`: enable offsite backup and use staging as the safer pre-production path

## 7. Capacity Guidance

The recommended `$150` stack should be described as:

- one always-on production ERP deployment
- suitable for small-to-mid plant use
- strong enough for normal concurrent owner, planner, store, dispatch, sales, and engineering activity

Do not promise a fixed maximum user count. Scale based on signals:

- rising API latency
- growing queue lag
- slow report generation
- sustained DB pressure
- worker backlog during shift or report spikes

## 8. Deployment Recommendation By Budget

| Budget | Best use |
| --- | --- |
| `$100` | Launch the live system on lean managed infrastructure |
| `$150` | Best overall balance of reliability, headroom, and simplicity |
| `$200` | Add always-on staging without weakening production |

## 9. When To Compare Against In-House Hosting

Under `$150`, Render remains the simplest managed option for this project.

Around `$200`, Render is still convenient, but the price is close enough that an in-house server plus VPN model becomes a valid comparison if:

- the team is comfortable operating infrastructure directly
- uptime responsibility can be owned internally
- offsite backups, patching, and remote access controls can be managed consistently

## 10. Current Default Blueprint

The repo's default `render.yaml` should match the recommended `$150` option:

- production only
- backend `standard`
- frontend `starter`
- worker `standard`
- beat `starter`
- Postgres `pro-4gb` with `20 GB`
- Redis `starter`

The `$100` and `$200` variants should stay documented as adjustments, not as separate official Blueprint files.

## 11. Pricing References

Pricing references used for this guide:

- [Render pricing](https://render.com/pricing)
- [Render PostgreSQL docs](https://render.com/docs/postgresql)
- [GitHub pricing](https://github.com/pricing)

Vendor pricing changes over time. Re-check the linked pricing pages before entering billing details.

# Release: floor terminal speed (16 Oct 2026, evening)

**Why:** on 16 Oct, WCM and machine terminals showed "Data load failed · This request took too long" (the browser gives a request 15 s). The live request log (`queue_request`, path and timing only) showed single requests of 5–60 s: `eligible-rolls` p50 5.9 s / max 59 s, job `context` p50 5.4 s / max 21 s, `tiered-rolls` 29 s with 1,633 queries, WCM `history` 6.5 s with 1,134 queries. While such a request ran it held one of the 8 gunicorn slots, so even 20 ms requests from other terminals waited behind it.

**Root cause:** roll discovery loaded every available roll of the plant (6,300+ on live) into Python and ran the compatibility check per roll, and did so 4–8 times per request (`get_job_context` resolves the WIP pool twice plus satisfaction plus eligible rolls; `tiered-rolls` calls `get_job_context` four times). The WCM history serialized each row's "skip next step" options by rebuilding the route graph per job (~150 queries per row).

## Changes (behaviour unchanged, only faster)

- **Per-request memo** (`config/request_context.py`, armed by the middleware for GET/HEAD only): job context, WIP pool, satisfaction, step target specs/slots, step roll spec, eligible rolls, combine process codes, route graph normalisation, template policy, predecessor completion sets and runtime skip options are computed once per request. Writes never use it.
- **SQL candidate pre-filter** (`ExecutionService._roll_candidate_prefilter`): the rules `_is_roll_step_compatible` applies to every roll (step bound, raw/remainder exclusion past step 0, step-0 purchasable variants, film variant/family from the target specs) now run in SQL before rolls are loaded. Proven identical: eligible rolls, discoverable and lineage pools matched with and without the filter for 225 open jobs on a 15,400-roll test DB, and `test_read_performance_guards.py` keeps that proof.
- **Eligible rolls serializer** loads plant, batch and job in the same query set (was 2 queries per roll). The WCM page asks for the first 400 inline suggestions (`?limit=`); the roll picker still loads the complete tiered list.
- **WCM history** skips the per-job execution profile (the panel never reads it) and joins routing rule, work centre, stock order and batch.
- **Server:** gunicorn 3 workers × 3 threads (same 9 slots, two processes can use both CPUs); access log carries the request time (`%(M)sms`); any request over `SLOW_REQUEST_MS` (default 2000) is logged as `slow_request` with path, duration, query count and role. Django's gzip middleware is off in production because Caddy already compresses.
- **Screens:** a background refresh that times out while the screen still shows data no longer raises the "Data load failed" toast (the sync banner carries it); history polls every 2 min, stats and stalled jobs every 60 s.

## Measured (local, same 2×4 gunicorn as live, 15,400 rolls / 2,100 jobs / 63-job queue)

| request | before | after |
|---|---|---|
| pouching `tiered-rolls` | 2,611 ms | 94 ms |
| pouching `context` | 589 ms | 74 ms |
| lamination `tiered-rolls` | 633 ms | 190 ms |
| WCM `history` (20 rows) | 1,580 ms / 3,567 q | 349 ms / 184 q |
| printing with 3,000 matching stock rolls `eligible-rolls` | 1,780 ms / 6,099 q | 938 ms / 18 q |
| 12 terminals loading at the same instant, p95 | 7.1 s | 3.6 s |

## Known business gap (not changed here)

A roll→bulk step at step 0 (bag making straight from purchased film) accepts any roll of the plant with a step index ≤ 1 regardless of film, by design of `_is_roll_step_compatible` ("layer-level target specs do not apply" to roll→bulk). With thousands of purchased rolls this is also the heaviest list. Recommend: filter step-0 roll→bulk candidates by the order's film variant/family and width like other steps. Decision needed.

## Migrations / env

None. `GUNICORN_WORKERS`/`GUNICORN_THREADS` are set in `deploy/aws/docker-compose.yml` (compose `environment` overrides `app.env`). New optional env: `SLOW_REQUEST_MS`.

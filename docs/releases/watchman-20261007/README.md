# Watchman and visitor gate release, 7 October 2026

## Verified starting point

The isolated checkout is `/private/tmp/tpp-watchman-20261007`, on branch
`codex/watchman-gate-20261007`, based on
`d04c2c06cac24bf6a3c35edcaec6e25ffc7db96f` from
`https://github.com/dev2495/total-blueprint-erp.git`.

Read-only SSH on 7 October confirmed the same full commit in
`/opt/tpp-erp/releases/current-commit`. The application symlink points to
`/opt/tpp-erp/releases/580d826`, whose candidate marker is `d04c2c0`.
SHA-256 comparison of all 2,078 Git-tracked source files found no missing or
different source files. The running image revision labels are `unknown`; this
release's build script explicitly embeds and verifies the full candidate SHA.

Public readiness returned `ready`. Backend/frontend were healthy, worker/beat
running, and the host had 39 GB free. These observations establish the baseline,
not acceptance of the new gate feature.

## Local development

Use the fresh local PostgreSQL database `tpp_gate_dev_20261007`; no production
database or records are imported. Dependencies are installed in `.venv` and
`frontend_v2/node_modules`. Local environment values are in ignored
`.runtime/gate-local.env` with mode 0600. API and frontend ports are 8017 and 3017.

From the repository root:

```sh
set -a
. .runtime/gate-local.env
set +a
.venv/bin/python manage.py migrate --noinput
.venv/bin/python manage.py runserver 127.0.0.1:8017 --noreload
```

In a separate terminal, from `frontend_v2`:

```sh
set -a
. ../.runtime/gate-local.env
set +a
./scripts/with-supported-node.sh env DISABLE_NEXT_WEBPACK_PERSISTENT_CACHE=1 \
  next dev -H 127.0.0.1 -p 3017
```

The local environment supplies Codex's bundled Node 24.19 executable through
`WORKSPACE_NODE_BIN`; the host default Node 26 does not meet this project's
supported-version check. Installs use temporary writable npm/uv caches; no user
cache permissions were changed.

Gate dependencies are pinned to cryptography 50.0.2, Pillow 12.3.0, and qrcode 8.2.
The regenerated hash lock kept every existing pinned version unchanged by
constraining resolution to the original lock. Only cffi, cryptography, pycparser,
and qrcode are new lock entries; Pillow was already a transitive dependency.

Run meaningful backend tests and migration checks with the same local environment;
run frontend typecheck/build/lint and mobile/desktop browser acceptance before
creating the candidate release archive. Never use reset or wipe scripts.

## Gate privacy and durable storage

The backend stores bounded, sanitized visitor selfies in private database fields.
Government IDs use Fernet encryption with `GATE_ID_ENCRYPTION_KEY`. Protected gate
API handlers return images only to authorized users. Neither selfies nor IDs are
written to `MEDIA_ROOT`, and no public media volume is added.

Before migrations, run `deploy/aws/bootstrap-gate-secrets.py` as root on the
production host. It appends a fresh random key only if one is absent, validates
and retains an existing valid key, uses an atomic mode-0600 update, and never
prints secret values. Do not run with shell tracing. The existing private
environment file must be preserved with the deployment recovery configuration;
losing or replacing the encryption key makes existing encrypted gate IDs
unreadable. Application rollback must retain the key and additive gate schema.

Production compose sets `GATE_PUBLIC_ORIGIN=https://erp.totalpolyprint.com` and
`GATE_TIME_ZONE=Asia/Kolkata` without changing the ERP's global timezone.
Public QR/form URLs must use that origin and the plant's active opaque UUID
gate token. Plant codes or plant IDs are not public registration authority. Photos and
government IDs must not appear in audit payloads, reports, log messages, error
traces, browser URLs, or report attachments.

The live proxy address was independently verified as `172.18.0.1` using Docker's
network gateway and backend health access logs. Current Caddy configuration has
SHA-256 `6d1b2a9f108f7fba0e974b73c5649b2bc49f6f48fbb3c5cb155a26275b01db29`.
The reviewed change makes Caddy overwrite `X-Real-IP` with `{remote_host}` and
trusts only that exact proxy address for gate throttling. It never trusts inbound
`X-Forwarded-For` or broad private ranges. This header overwrite is required:
unmodified incoming headers would otherwise allow callers to spoof their rate
bucket. [Caddy's header documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers)
describes overwrite semantics and the default pass-through behavior.

`activate-caddy.sh` requires the recorded configuration hash and gateway,
validates the candidate, preserves the old file, reloads the service, and restores
the old configuration on failure. Application rollback also restores that file.
If the live configuration or network changes, stop and review the exact proxy
instead of weakening the checks. After deployment, verify spoofed `X-Real-IP`
headers do not create caller-selected rate buckets.

Rollback also disables active WATCHMAN-role accounts before starting the older
application, whose authenticated ERP views do not implement the watchman ceiling.
It changes no passwords and no users in other roles. Original account IDs and
active flags are retained under `rollback-private/watchman-account-state.json`
with directory mode 0700/file mode 0600; account IDs are never printed. Recovery
must retain this file and re-enable only the recorded accounts that still hold
the WATCHMAN role after the repaired release passes the ceiling checks. Automatic
rollback never re-enables them. Failure to preserve account state or disable
accounts stops rollback before the old application starts.

## Release sequence

1. Finish backend, RBAC, Claude-authored frontend, report integration and QR
   acceptance. Record validation results and current commit in this directory.
2. Review the tracked candidate diff and all additive migrations; commit the
   complete candidate. Create the archive with `git archive --format=tar.gz` so
   `.env`, `.venv`, `.runtime`, `node_modules`, and unrelated local files are
   excluded. Record archive SHA-256 and candidate SHA.
3. Recheck the expected parent, runtime health, available disk space and image
   identities. Run `BackupService.run_database_backup` with a unique release
   attempt key, followed by `BackupService.run_restore_drill`; require successful
   checksums and restored-database smoke results before changing production.
4. Upload the reviewed archive as `/tmp/tpp-gate-<12-char SHA>.tar.gz`. Run
   `build-release.sh <full SHA> <archive SHA-256> <full expected parent>` on the
   host as root. This only stages source/builds and preserves current images.
5. Provision/validate the private gate key. Run Django `check --deploy` on the
   candidate and inspect the migration plan. Require the exact reviewed set;
   reject any unrelated or unexpected migration before executing migrations.
6. Activate the candidate using the reviewed activation script. Preserve the
   old app source and rollback image tags. Wait only for backend/frontend health,
   then separately check worker/beat running and Celery `pong`. Readiness and
   `/login` must return 200. Verify all service image revisions match the SHA and
   update `current-commit` only after acceptance checks pass.
7. Run `scripts/verify_gate_live_acceptance.py --expected-sha <full SHA>` inside
   the new backend container. It requires the matching runtime build SHA and
   production PostgreSQL, signs ordinary JWTs for temporary users, exercises
   bearer/cookie/CSRF authentication and actual gate API endpoints, checks
   owner/report/watchman ceilings and plant scopes, verifies private encrypted
   visitor data, lifecycle/idempotency, corrections, audit and QR flows, and
   hashes complete rows in 103 ERP/master tables. An SQL mutation allowlist
   rejects writes outside feature/auth tables. All acceptance writes run inside
   one outer transaction that always rolls back; post-rollback checks require
   zero persistent synthetic users, visitors, movements, audit, receipts or
   throttle buckets. No existing passwords, users, plants or business masters
   are changed. Per-request savepoints keep expected DRF 4xx responses from
   aborting this test transaction. Concurrency is tested separately against
   isolated local PostgreSQL, where committed synthetic fixtures are safe.
8. Run `scripts/collect_gate_release_status.py --expected-sha <full SHA>` inside
   the new backend container for bounded PostgreSQL read-only status. It records
   safe counts, exact migration/audit-trigger state, QR coverage, owner-only
   daily report default, encryption/proxy/timezone configuration and backup/
   restore identifiers; it never provisions missing state. Finish browser
   public-form/QR acceptance and record any remaining physical-phone selfie/
   camera and printed-QR scan gates honestly.

The existing release procedure restarts application containers. Earlier releases
observed brief HTTP 502 responses during activation; this procedure does not
promise zero downtime. Roll back application images/source on health failure
while retaining the additive schema and encryption key. Never restore the live
business database merely to roll back an additive application release.

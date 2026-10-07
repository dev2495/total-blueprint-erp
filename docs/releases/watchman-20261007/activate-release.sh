#!/usr/bin/env bash
set -euo pipefail

# Run only after the reviewed candidate and a verified backup/restore drill.
CANDIDATE_SHA="${1:?full candidate commit required}"
EXPECTED_PARENT="${2:?full current deployed commit required}"
[[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$EXPECTED_PARENT" =~ ^[0-9a-f]{40}$ ]]
CANDIDATE_TAG="${CANDIDATE_SHA:0:12}"
RELEASE_DIR="/opt/tpp-erp/releases/$CANDIDATE_TAG"
OLD_APP="/opt/tpp-erp/releases/rollback-app-gate-${EXPECTED_PARENT:0:12}-$CANDIDATE_TAG"
ROLLBACK_TAG="gate-${EXPECTED_PARENT:0:12}-$CANDIDATE_TAG"
COMPOSE="$RELEASE_DIR/deploy/aws/docker-compose.yml"
test "$(cat /opt/tpp-erp/releases/current-commit)" = "$EXPECTED_PARENT"
test "$(cat "$RELEASE_DIR/candidate-commit")" = "$CANDIDATE_SHA"
test ! -e "$OLD_APP"
test ! -L "$OLD_APP"
test -f "$RELEASE_DIR/docs/releases/watchman-20261007/reviewed-migrations.json"
for service in backend frontend; do
  test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "tpp-erp-$service:$CANDIDATE_TAG")" = "$CANDIDATE_SHA"
done
python3 "$RELEASE_DIR/deploy/aws/bootstrap-gate-secrets.py"
docker run --rm --network tpp-erp-private --env-file /opt/tpp-erp/secrets/app.env \
  --security-opt no-new-privileges:true --cap-drop ALL "tpp-erp-backend:$CANDIDATE_TAG" \
  python manage.py shell -c 'import json; from pathlib import Path; from django.db import connection; from django.db.migrations.executor import MigrationExecutor
allowed={tuple(item) for item in json.loads(Path("docs/releases/watchman-20261007/reviewed-migrations.json").read_text())}
executor=MigrationExecutor(connection)
plan=executor.migration_plan(executor.loader.graph.leaf_nodes())
pending={(migration.app_label,migration.name) for migration,backwards in plan}
applied=set(executor.loader.applied_migrations)
print("Reviewed pending migrations",sorted(pending))
print("Reviewed already-applied migrations",sorted(allowed & applied))
if any(backwards for migration,backwards in plan) or pending - allowed or allowed - (pending | applied):
    raise RuntimeError("Migration plan is not the reviewed pending/already-applied set.")'
docker run --rm --network tpp-erp-private --env-file /opt/tpp-erp/secrets/app.env \
  --security-opt no-new-privileges:true --cap-drop ALL "tpp-erp-backend:$CANDIDATE_TAG" \
  python manage.py check --deploy
docker run --rm --network tpp-erp-private --env-file /opt/tpp-erp/secrets/app.env \
  --security-opt no-new-privileges:true --cap-drop ALL "tpp-erp-backend:$CANDIDATE_TAG" \
  python manage.py migrate --noinput
bash "$RELEASE_DIR/docs/releases/watchman-20261007/activate-caddy.sh" "$RELEASE_DIR"

rollback() {
  echo "Rolling back gate application source and images; retaining additive schema and key."
  # Pre-gate views do not enforce the watchman ceiling. Fail closed before
  # starting old images, retaining original active flags privately.
  bash "$RELEASE_DIR/docs/releases/watchman-20261007/quarantine-watchman-on-rollback.sh" "$RELEASE_DIR" "$ROLLBACK_TAG"
  docker tag "tpp-erp-backend:rollback-$ROLLBACK_TAG" tpp-erp-backend:production
  docker tag "tpp-erp-frontend:rollback-$ROLLBACK_TAG" tpp-erp-frontend:production
  if test -e "$OLD_APP" || test -L "$OLD_APP"; then
    if test -L /opt/tpp-erp/app && test "$(readlink /opt/tpp-erp/app)" = "$RELEASE_DIR"; then
      unlink /opt/tpp-erp/app
      mv "$OLD_APP" /opt/tpp-erp/app
    else
      echo "Application path changed unexpectedly; preserve both sources for administrator recovery." >&2
      return 1
    fi
  fi
  docker compose -p aws -f /opt/tpp-erp/app/deploy/aws/docker-compose.yml up -d --no-deps backend worker beat frontend
  docker compose -p aws -f /opt/tpp-erp/app/deploy/aws/docker-compose.yml up -d --no-deps --wait --wait-timeout 180 backend frontend
  if test -f "$RELEASE_DIR/caddy-before-gate.conf"; then
    test "$(sha256sum /etc/caddy/Caddyfile | cut -d ' ' -f 1)" = "$(sha256sum "$RELEASE_DIR/deploy/aws/Caddyfile.domain" | cut -d ' ' -f 1)"
    cp --preserve=mode,ownership,timestamps "$RELEASE_DIR/caddy-before-gate.conf" /etc/caddy/Caddyfile
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    systemctl reload caddy
  fi
  printf '%s\n' "$EXPECTED_PARENT" > /opt/tpp-erp/releases/current-commit
}
trap 'rc=$?; trap - ERR; rollback; exit "$rc"' ERR
mv /opt/tpp-erp/app "$OLD_APP"
ln -s "$RELEASE_DIR" /opt/tpp-erp/app
docker tag "tpp-erp-backend:$CANDIDATE_TAG" tpp-erp-backend:production
docker tag "tpp-erp-frontend:$CANDIDATE_TAG" tpp-erp-frontend:production
docker compose -p aws -f "$COMPOSE" up -d --no-deps backend worker beat frontend
docker compose -p aws -f "$COMPOSE" up -d --no-deps --wait --wait-timeout 180 backend frontend
for service in backend worker beat frontend; do
  test "$(docker inspect --format '{{.State.Running}}' "aws-$service-1")" = true
  test "$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "aws-$service-1")" = "$CANDIDATE_SHA"
done
# Consume the complete probe before matching it: grep -q in a pipeline can
# close early and SIGPIPE a healthy Celery command under set -o pipefail.
(umask 077; docker exec aws-backend-1 celery -A config inspect ping --timeout=15 > "$RELEASE_DIR/celery-ping.log" 2>&1)
grep -q pong "$RELEASE_DIR/celery-ping.log"
curl --fail --silent --show-error --max-time 20 -H 'Host: erp.totalpolyprint.com' -H 'X-Forwarded-Proto: https' http://127.0.0.1:8000/api/health/ready/ > "$RELEASE_DIR/ready.json"
curl --fail --silent --show-error --max-time 20 http://127.0.0.1:3000/login > /dev/null
printf '%s\n' "$CANDIDATE_SHA" > /opt/tpp-erp/releases/current-commit
trap - ERR
echo "Gate application activated with verified service identities and health. Complete signed-in acceptance."

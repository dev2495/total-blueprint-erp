#!/usr/bin/env bash
set -euo pipefail

if test "$#" -ne 3; then
  echo "Usage: activate-release.sh FULL_CANDIDATE_SHA EXPECTED_PARENT_SHA BACKUP_PROOF_JSON" >&2
  exit 2
fi
CANDIDATE_SHA="$1"
EXPECTED_PARENT="$2"
BACKUP_PROOF="$3"
[[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]]
test "$EXPECTED_PARENT" = "72759ea64c703118a670b507b5aacfec417ae6f7"
CANDIDATE_TAG="$(printf '%s' "$CANDIDATE_SHA" | cut -c1-12)"
RELEASE_DIR="/opt/tpp-erp/releases/$CANDIDATE_TAG"
HELPERS="$RELEASE_DIR/docs/releases/bill-intake-20261008"
OLD_APP="/opt/tpp-erp/releases/rollback-app-bill-$CANDIDATE_TAG"
ROLLBACK_TAG="bill-$CANDIDATE_TAG"
COMPOSE="$RELEASE_DIR/deploy/aws/docker-compose.yml"
test "$(cat "$RELEASE_DIR/candidate-commit")" = "$CANDIDATE_SHA"
test ! -e "$OLD_APP"
test ! -L "$OLD_APP"
test -f "$BACKUP_PROOF"
test ! -L "$BACKUP_PROOF"
python3 "$HELPERS/readonly-host-state.py" --expected-sha "$EXPECTED_PARENT" --compare "$RELEASE_DIR/host-before.json"
for service in backend frontend; do
  test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "tpp-erp-$service:$CANDIDATE_TAG")" = "$CANDIDATE_SHA"
  test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "tpp-erp-$service:rollback-$ROLLBACK_TAG")" = "$EXPECTED_PARENT"
done

# Read-only prerequisite verification binds the exact managed backup, restored
# artifact, fresh record and reviewed new migrations. Secrets/Caddy stay intact.
docker run --rm -i --network tpp-erp-private --env-file /opt/tpp-erp/secrets/app.env \
  --security-opt no-new-privileges:true --cap-drop ALL \
  -v /opt/tpp-erp/backups:/var/backups/tpp-erp:ro "tpp-erp-backend:$CANDIDATE_TAG" \
  python docs/releases/bill-intake-20261008/review-migrations.py --expected-sha "$CANDIDATE_SHA" --backup-proof < "$BACKUP_PROOF"
docker run --rm --network tpp-erp-private --env-file /opt/tpp-erp/secrets/app.env \
  --security-opt no-new-privileges:true --cap-drop ALL "tpp-erp-backend:$CANDIDATE_TAG" \
  python manage.py check --deploy
docker run --rm --network tpp-erp-private --env-file /opt/tpp-erp/secrets/app.env \
  --security-opt no-new-privileges:true --cap-drop ALL -e 'PGOPTIONS=-c lock_timeout=5000' \
  "tpp-erp-backend:$CANDIDATE_TAG" python manage.py migrate --noinput
docker run --rm --network tpp-erp-private --env-file /opt/tpp-erp/secrets/app.env \
  --security-opt no-new-privileges:true --cap-drop ALL "tpp-erp-backend:$CANDIDATE_TAG" \
  python docs/releases/bill-intake-20261008/review-migrations.py --expected-sha "$CANDIDATE_SHA"
python3 "$HELPERS/readonly-host-state.py" --expected-sha "$EXPECTED_PARENT" --compare "$RELEASE_DIR/host-before.json"

rollback() {
  echo "Restoring exact private repair source/images; retaining additive bill schema and records."
  docker tag "tpp-erp-backend:rollback-$ROLLBACK_TAG" tpp-erp-backend:production
  docker tag "tpp-erp-frontend:rollback-$ROLLBACK_TAG" tpp-erp-frontend:production
  if test -L "$OLD_APP" && test "$(readlink -f "$OLD_APP")" = "/opt/tpp-erp/releases/72759ea64c70" && {
    { test ! -e /opt/tpp-erp/app && test ! -L /opt/tpp-erp/app; } ||
    { test -L /opt/tpp-erp/app && test "$(readlink /opt/tpp-erp/app)" = "$RELEASE_DIR"; }
  }; then
    if test -L /opt/tpp-erp/app; then unlink /opt/tpp-erp/app; fi
    mv "$OLD_APP" /opt/tpp-erp/app
  elif test "$(readlink -f /opt/tpp-erp/app)" != "/opt/tpp-erp/releases/72759ea64c70"; then
    echo "Source pointer changed unexpectedly; preserve both checkouts for recovery." >&2
    return 1
  fi
  docker compose -p aws -f /opt/tpp-erp/app/deploy/aws/docker-compose.yml up -d --no-deps backend worker beat frontend
  docker compose -p aws -f /opt/tpp-erp/app/deploy/aws/docker-compose.yml up -d --no-deps --wait --wait-timeout 180 backend frontend
  printf '%s\n' "$EXPECTED_PARENT" > /opt/tpp-erp/releases/current-commit
  python3 "$HELPERS/readonly-host-state.py" --expected-sha "$EXPECTED_PARENT" --compare "$RELEASE_DIR/host-before.json"
}
trap 'rc=$?; trap - ERR; rollback; exit "$rc"' ERR
mv /opt/tpp-erp/app "$OLD_APP"
ln -s "$RELEASE_DIR" /opt/tpp-erp/app
docker tag "tpp-erp-backend:$CANDIDATE_TAG" tpp-erp-backend:production
docker tag "tpp-erp-frontend:$CANDIDATE_TAG" tpp-erp-frontend:production
docker compose -p aws -f "$COMPOSE" up -d --no-deps backend worker beat frontend
docker compose -p aws -f "$COMPOSE" up -d --no-deps --wait --wait-timeout 180 backend frontend

# Capture the entire probe before matching; a grep -q pipeline can SIGPIPE.
(umask 077; docker exec aws-backend-1 celery -A config inspect ping --timeout=15 > "$RELEASE_DIR/celery-ping.log" 2>&1)
grep -q pong "$RELEASE_DIR/celery-ping.log"
curl --fail --silent --show-error --max-time 20 -H 'Host: erp.totalpolyprint.com' -H 'X-Forwarded-Proto: https' http://127.0.0.1:8000/api/health/ready/ > "$RELEASE_DIR/ready.json"
curl --fail --silent --show-error --max-time 20 http://127.0.0.1:3000/login > /dev/null
python3 "$HELPERS/readonly-host-state.py" --expected-sha "$CANDIDATE_SHA" --marker-sha "$EXPECTED_PARENT" --compare "$RELEASE_DIR/host-before.json" --save "$RELEASE_DIR/host-after.json"
printf '%s\n' "$CANDIDATE_SHA" > /opt/tpp-erp/releases/current-commit
trap - ERR
echo "Bill intake activated with exact service revisions; complete authenticated rollback-only acceptance."

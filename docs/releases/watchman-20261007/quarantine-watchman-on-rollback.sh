#!/usr/bin/env bash
set -euo pipefail
umask 077
RELEASE_DIR="${1:?candidate release directory required}"
ROLLBACK_TAG="${2:?preserved backend rollback tag required}"
[[ "$RELEASE_DIR" =~ ^/opt/tpp-erp/releases/[0-9a-f]{12}$ ]]
[[ "$ROLLBACK_TAG" =~ ^gate-[0-9a-f]{12}-[0-9a-f]{12}$ ]]
RECOVERY_DIR="$RELEASE_DIR/rollback-private"
install -d -o root -g root -m 700 "$RECOVERY_DIR"
# The preserved, known-working backend image is used even when the candidate
# is unhealthy. Account fields are unchanged by gate migrations.
docker run --rm --user 0:0 --network tpp-erp-private \
  --env-file /opt/tpp-erp/secrets/app.env \
  --security-opt no-new-privileges:true --cap-drop ALL \
  --mount "type=bind,src=$RECOVERY_DIR,dst=/release-recovery" \
  -i "tpp-erp-backend:rollback-$ROLLBACK_TAG" \
  python -u - --authorized-application-rollback \
  < "$RELEASE_DIR/docs/releases/watchman-20261007/quarantine-watchman-on-rollback.py"
test "$(stat -c '%a' "$RECOVERY_DIR/watchman-account-state.json")" = 600

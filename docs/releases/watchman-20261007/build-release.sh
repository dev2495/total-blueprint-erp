#!/usr/bin/env bash
set -euo pipefail

# Run on the production host. Upload a Git-tracked-only archive first.
CANDIDATE_SHA="${1:?full candidate commit required}"
ARCHIVE_SHA256="${2:?archive checksum required}"
EXPECTED_PARENT="${3:?full current deployed commit required}"
[[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$EXPECTED_PARENT" =~ ^[0-9a-f]{40}$ ]]
[[ "$ARCHIVE_SHA256" =~ ^[0-9a-f]{64}$ ]]
test "$(cat /opt/tpp-erp/releases/current-commit)" = "$EXPECTED_PARENT"
CANDIDATE_TAG="${CANDIDATE_SHA:0:12}"
RELEASE_DIR="/opt/tpp-erp/releases/$CANDIDATE_TAG"
ARCHIVE="/tmp/tpp-gate-$CANDIDATE_TAG.tar.gz"
test ! -e "$RELEASE_DIR"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$ARCHIVE" | sha256sum -c -
if tar -tzf "$ARCHIVE" | grep -Eq '(^|/)\.env$|(^|/)\.env\.local$|(^|/)\.git/|(^|/)\.venv/|(^|/)\.runtime/|(^|/)\.\./|^/'; then
  echo "Release archive contains forbidden private/runtime paths." >&2
  exit 1
fi
mkdir "$RELEASE_DIR"
tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"
test -f "$RELEASE_DIR/requirements.txt"
test -f "$RELEASE_DIR/apps/gate/apps.py"
test -f "$RELEASE_DIR/deploy/aws/bootstrap-gate-secrets.py"
BACKEND_OLD=$(docker inspect --format '{{.Image}}' aws-backend-1)
FRONTEND_OLD=$(docker inspect --format '{{.Image}}' aws-frontend-1)
ROLLBACK_TAG="gate-${EXPECTED_PARENT:0:12}-$CANDIDATE_TAG"
docker tag "$BACKEND_OLD" "tpp-erp-backend:rollback-$ROLLBACK_TAG"
docker tag "$FRONTEND_OLD" "tpp-erp-frontend:rollback-$ROLLBACK_TAG"
printf '%s\n%s\n%s\n' "$EXPECTED_PARENT" "$BACKEND_OLD" "$FRONTEND_OLD" > "$RELEASE_DIR/rollback-identities.txt"
docker build --build-arg "APP_BUILD_SHA=$CANDIDATE_SHA" -t "tpp-erp-backend:$CANDIDATE_TAG" -f "$RELEASE_DIR/deploy/aws/Dockerfile.backend" "$RELEASE_DIR"
docker build --build-arg "APP_BUILD_SHA=$CANDIDATE_SHA" -t "tpp-erp-frontend:$CANDIDATE_TAG" -f "$RELEASE_DIR/deploy/aws/Dockerfile.frontend" "$RELEASE_DIR"
for service in backend frontend; do
  test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "tpp-erp-$service:$CANDIDATE_TAG")" = "$CANDIDATE_SHA"
done
printf '%s\n' "$CANDIDATE_SHA" > "$RELEASE_DIR/candidate-commit"
echo "Gate candidate images built and identities verified. Production remains on the current release."

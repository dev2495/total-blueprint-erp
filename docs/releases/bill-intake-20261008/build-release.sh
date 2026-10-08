#!/usr/bin/env bash
set -euo pipefail

if test "$#" -ne 3; then
  echo "Usage: build-release.sh FULL_CANDIDATE_SHA ARCHIVE_SHA256 EXPECTED_PARENT_SHA" >&2
  exit 2
fi
CANDIDATE_SHA="$1"
ARCHIVE_SHA256="$2"
EXPECTED_PARENT="$3"
[[ "$CANDIDATE_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$ARCHIVE_SHA256" =~ ^[0-9a-f]{64}$ ]]
test "$EXPECTED_PARENT" = "72759ea64c703118a670b507b5aacfec417ae6f7"
test "$(cat /opt/tpp-erp/releases/current-commit)" = "$EXPECTED_PARENT"
CANDIDATE_TAG="$(printf '%s' "$CANDIDATE_SHA" | cut -c1-12)"
RELEASE_DIR="/opt/tpp-erp/releases/$CANDIDATE_TAG"
ARCHIVE="/tmp/tpp-bill-$CANDIDATE_TAG.tar.gz"
test ! -e "$RELEASE_DIR"
printf '%s  %s\n' "$ARCHIVE_SHA256" "$ARCHIVE" | sha256sum -c -

# Consume the complete archive inspection; avoid grep -q SIGPIPE under pipefail.
python3 - "$ARCHIVE" <<'PY'
import sys,tarfile
from pathlib import PurePosixPath
with tarfile.open(sys.argv[1],"r:gz") as archive:
    for member in archive.getmembers():
        parts=PurePosixPath(member.name).parts
        forbidden={".git",".runtime",".venv","node_modules",".next",".env",".env.local",".env.production","app.env"}
        if member.name.startswith("/") or ".." in parts or forbidden.intersection(parts) or not (member.isfile() or member.isdir()):
            raise SystemExit("Release archive contains an unsafe/private member.")
PY
mkdir "$RELEASE_DIR"
tar -xzf "$ARCHIVE" -C "$RELEASE_DIR"
HELPERS="$RELEASE_DIR/docs/releases/bill-intake-20261008"
test -f "$HELPERS/source-provenance.json"
test -f "$HELPERS/reviewed-migrations.json"
python3 "$HELPERS/readonly-host-state.py" --expected-sha "$EXPECTED_PARENT" --save "$RELEASE_DIR/host-before.json"
BACKEND_OLD="$(docker inspect --format '{{.Image}}' aws-backend-1)"
FRONTEND_OLD="$(docker inspect --format '{{.Image}}' aws-frontend-1)"
ROLLBACK_TAG="bill-$CANDIDATE_TAG"
docker tag "$BACKEND_OLD" "tpp-erp-backend:rollback-$ROLLBACK_TAG"
docker tag "$FRONTEND_OLD" "tpp-erp-frontend:rollback-$ROLLBACK_TAG"
printf '%s\n%s\n%s\n' "$EXPECTED_PARENT" "$BACKEND_OLD" "$FRONTEND_OLD" > "$RELEASE_DIR/rollback-identities.txt"
docker build --build-arg "APP_BUILD_SHA=$CANDIDATE_SHA" -t "tpp-erp-backend:$CANDIDATE_TAG" -f "$RELEASE_DIR/deploy/aws/Dockerfile.backend" "$RELEASE_DIR"
docker build --build-arg "APP_BUILD_SHA=$CANDIDATE_SHA" -t "tpp-erp-frontend:$CANDIDATE_TAG" -f "$RELEASE_DIR/deploy/aws/Dockerfile.frontend" "$RELEASE_DIR"
for service in backend frontend; do
  test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "tpp-erp-$service:$CANDIDATE_TAG")" = "$CANDIDATE_SHA"
done
python3 "$HELPERS/readonly-host-state.py" --expected-sha "$EXPECTED_PARENT" --compare "$RELEASE_DIR/host-before.json"
printf '%s\n' "$CANDIDATE_SHA" > "$RELEASE_DIR/candidate-commit"
echo "Bill intake candidate images verified. Production remains on the private repair parent."

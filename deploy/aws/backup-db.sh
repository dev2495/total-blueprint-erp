#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/tpp-erp/app"
ENV_FILE="/opt/tpp-erp/secrets/app.env"
BACKUP_DIR="/opt/tpp-erp/backups/daily"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S%z)"
backup_file="$BACKUP_DIR/tpp-erp-db-${timestamp}.sql.gz"
tmp_file="${backup_file}.tmp"

cd "$APP_DIR"

docker compose -f deploy/aws/docker-compose.yml exec -T postgres \
  pg_dump \
    -U "${POSTGRES_USER:?POSTGRES_USER missing}" \
    -d "${POSTGRES_DB:?POSTGRES_DB missing}" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
  | gzip -9 > "$tmp_file"

mv "$tmp_file" "$backup_file"
sha256sum "$backup_file" > "${backup_file}.sha256"
chmod 600 "$backup_file" "${backup_file}.sha256"

retention_days="${BACKUP_RETENTION_DAYS:-30}"
find "$BACKUP_DIR" -type f -name "tpp-erp-db-*.sql.gz" -mtime "+${retention_days}" -delete
find "$BACKUP_DIR" -type f -name "tpp-erp-db-*.sql.gz.sha256" -mtime "+${retention_days}" -delete

echo "Backup complete: $backup_file"

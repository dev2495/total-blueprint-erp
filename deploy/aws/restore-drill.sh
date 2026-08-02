#!/bin/sh
set -eu

backup_dir="${BACKUP_LOCAL_DIR:-/var/backups/tpp-erp/managed}"
db_host="${DB_HOST:-postgres}"
db_port="${DB_PORT:-5432}"
db_user="${DB_USER:-postgres}"
db_password="${DB_PASSWORD:-}"

latest_backup="$(
  find "$backup_dir" -maxdepth 1 -type f \
    \( -name 'erp_db_*.dump' -o -name 'erp_db_*.dump.enc' \) \
    -print | sort | tail -n 1
)"

if [ -z "$latest_backup" ]; then
  echo "No managed PostgreSQL backup is available for the restore drill." >&2
  exit 1
fi

work_dir="$(mktemp -d /tmp/tpp-restore-drill.XXXXXX)"
drill_db="tpp_restore_drill_$(date +%Y%m%d_%H%M%S)_$$"
restore_file="$latest_backup"
export PGPASSWORD="$db_password"

cleanup() {
  dropdb --if-exists -h "$db_host" -p "$db_port" -U "$db_user" "$drill_db" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT HUP INT TERM

case "$latest_backup" in
  *.enc)
    if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
      echo "BACKUP_ENCRYPTION_KEY is required to verify the encrypted backup." >&2
      exit 1
    fi
    restore_file="$work_dir/restore.dump"
    openssl enc -d -aes-256-cbc -pbkdf2 \
      -pass env:BACKUP_ENCRYPTION_KEY \
      -in "$latest_backup" \
      -out "$restore_file"
    ;;
esac

pg_restore --list "$restore_file" >/dev/null
createdb -h "$db_host" -p "$db_port" -U "$db_user" "$drill_db"
pg_restore --exit-on-error --no-owner --no-privileges \
  -h "$db_host" -p "$db_port" -U "$db_user" -d "$drill_db" "$restore_file"

migration_count="$(
  psql -v ON_ERROR_STOP=1 -h "$db_host" -p "$db_port" -U "$db_user" \
    -d "$drill_db" -Atqc 'SELECT COUNT(*) FROM django_migrations;'
)"

if [ "${migration_count:-0}" -le 0 ]; then
  echo "Restore drill smoke test found no Django migration history." >&2
  exit 1
fi

echo "Restore drill passed against an isolated temporary database."

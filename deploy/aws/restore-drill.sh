#!/bin/sh
set -eu

backup_dir="${BACKUP_LOCAL_DIR:-/var/backups/tpp-erp/managed}"
db_host="${DB_HOST:-postgres}"
db_port="${DB_PORT:-5432}"
db_user="${DB_USER:-postgres}"
db_password="${DB_PASSWORD:-}"

selected_backup="${RESTORE_BACKUP_PATH:-}"
expected_checksum="${RESTORE_BACKUP_SHA256:-}"
if [ -z "$selected_backup" ] || [ "${#expected_checksum}" -ne 64 ]; then
  echo "The selected backup path and SHA256 from BackupService are required." >&2
  exit 1
fi
case "$expected_checksum" in
  *[!0-9a-fA-F]*) echo "The selected backup SHA256 is invalid." >&2; exit 1 ;;
esac
case "$selected_backup" in
  *.dump|*.dump.enc) ;;
  *) echo "Restore requires a completed dump artifact; staging files are excluded." >&2; exit 1 ;;
esac
if [ ! -f "$selected_backup" ] || [ -L "$selected_backup" ]; then
  echo "The selected completed backup is unavailable." >&2
  exit 1
fi
managed_dir="$(cd "$backup_dir" && pwd -P)"
selected_dir="$(cd "$(dirname "$selected_backup")" && pwd -P)"
if [ "$managed_dir" != "$selected_dir" ]; then
  echo "The selected backup is outside the managed backup directory." >&2
  exit 1
fi

work_dir="$(mktemp -d /tmp/tpp-restore-drill.XXXXXX)"
drill_db="tpp_restore_drill_$(date +%Y%m%d_%H%M%S)_$$"
export PGPASSWORD="$db_password"

cleanup() {
  dropdb --if-exists -h "$db_host" -p "$db_port" -U "$db_user" "$drill_db" >/dev/null 2>&1 || true
  rm -rf "$work_dir"
}
trap cleanup EXIT HUP INT TERM

# Restore only a private copy of the selected artifact. A retention run cannot
# change the bytes being verified/restored after this copy has been checked.
verified_backup="$work_dir/$(basename "$selected_backup")"
cp "$selected_backup" "$verified_backup"
actual_checksum="$(openssl dgst -sha256 "$verified_backup" | awk '{print $NF}')"
if [ "$actual_checksum" != "$expected_checksum" ]; then
  echo "The selected backup failed SHA256 verification." >&2
  exit 1
fi
restore_file="$verified_backup"

case "$verified_backup" in
  *.enc)
    if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
      echo "BACKUP_ENCRYPTION_KEY is required to verify the encrypted backup." >&2
      exit 1
    fi
    restore_file="$work_dir/restore.dump"
    openssl enc -d -aes-256-cbc -pbkdf2 \
      -pass env:BACKUP_ENCRYPTION_KEY \
      -in "$verified_backup" \
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

# Run the actual application reads before cleanup and explicitly select the clone.
DB_NAME="$drill_db" DB_HOST="$db_host" DB_PORT="$db_port" DB_USER="$db_user" \
  SKIP_DOTENV_IMPORT=1 python manage.py verify_restored_database

echo "Restore drill passed against an isolated temporary database."

"""Reviewed release action, run explicitly inside the current backend container.

This creates a managed backup and a temporary restore database. It is not a
read-only probe; do not run as part of discovery or ordinary readiness checks.
It does not restore or mutate factory business records in the live database.
"""
import json
import os
import re
import sys

attempt_key = sys.argv[1] if len(sys.argv) == 2 else ""
if not re.fullmatch(r"gate-release-[a-zA-Z0-9-]{8,100}", attempt_key):
    raise SystemExit("Supply a unique gate-release-<candidate-and-attempt> identifier.")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from apps.platformops.services.backup_service import BackupService

backup = BackupService.run_database_backup(attempt_key=attempt_key)
if backup.status != "SUCCEEDED" or not backup.checksum_sha256 or not backup.size_bytes:
    raise SystemExit("Managed backup failed; preserve server diagnostics and do not activate.")
artifact = BackupService._backup_dir() / backup.file_name
if not artifact.is_file() or BackupService._sha256(artifact) != backup.checksum_sha256:
    raise SystemExit("Managed backup artifact checksum failed; do not activate.")
print(json.dumps({"backup_id": str(backup.id), "status": backup.status, "checksum_sha256": backup.checksum_sha256, "size_bytes": backup.size_bytes, "duration_seconds": backup.duration_seconds}), flush=True)
restore = BackupService.run_restore_drill()
if restore.status != "SUCCEEDED" or not restore.smoke_test_passed or restore.backup_record_id != backup.id:
    raise SystemExit("Restore drill did not successfully verify this backup; do not activate.")
print(json.dumps({"restore_id": str(restore.id), "backup_id": str(restore.backup_record_id), "status": restore.status, "smoke_test_passed": restore.smoke_test_passed, "duration_seconds": restore.duration_seconds}), flush=True)

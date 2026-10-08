#!/usr/bin/env python3
"""Explicit managed backup and exact-artifact temporary restore; no live restore."""
import hashlib
import json
import os
import re
import sys
from datetime import datetime, timezone


def run():
    if len(sys.argv) != 3:
        raise RuntimeError("Provide the exact parent SHA and a unique gate-release-bill- attempt key.")
    expected, attempt = sys.argv[1:]
    if expected != "72759ea64c703118a670b507b5aacfec417ae6f7" or os.getenv("APP_BUILD_SHA") != expected:
        raise RuntimeError("Backup must run against the verified current parent.")
    if not re.fullmatch(r"gate-release-bill-[a-zA-Z0-9-]{8,90}", attempt):
        raise RuntimeError("A unique bill release backup attempt identifier is required.")
    sys.path.insert(0, os.getcwd())
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    import django
    django.setup()
    from django.conf import settings
    from django.db import connection
    from apps.platformops.services.backup_service import BackupService
    if connection.vendor != "postgresql" or not settings.IS_PRODUCTION or settings.DEBUG:
        raise RuntimeError("Managed release backup requires the existing production backend.")
    backup = BackupService.run_database_backup(attempt_key=attempt)
    if backup.status != "SUCCEEDED" or not backup.checksum_sha256 or not backup.size_bytes:
        raise RuntimeError("Managed backup failed.")
    artifact = BackupService._backup_dir() / backup.file_name
    if not artifact.is_file() or artifact.is_symlink() or artifact.stat().st_size != backup.size_bytes or hashlib.sha256(artifact.read_bytes()).hexdigest() != backup.checksum_sha256:
        raise RuntimeError("Managed backup checksum verification failed.")
    restore = BackupService.run_restore_drill(backup_record=backup)
    if restore.status != "SUCCEEDED" or not restore.smoke_test_passed or restore.backup_record_id != backup.id:
        raise RuntimeError("Temporary restore did not verify the exact selected backup.")
    return {
        "status": "PASS", "checked_at": datetime.now(timezone.utc).isoformat(), "image_build_sha": expected,
        "backup": {"id": str(backup.id), "created_at": backup.created_at.isoformat(), "checksum_sha256": backup.checksum_sha256, "size_bytes": backup.size_bytes},
        "restore": {"id": str(restore.id), "backup_id": str(restore.backup_record_id), "created_at": restore.created_at.isoformat(), "smoke_test_passed": True},
        "live_business_restore_performed": False,
    }


if __name__ == "__main__":
    try:
        print(json.dumps(run(), sort_keys=True), flush=True)
    except Exception:
        print(json.dumps({"status": "FAIL", "check": "Managed backup/restore prerequisite failed; preserve server diagnostics and do not activate."}), flush=True)
        raise SystemExit(1)

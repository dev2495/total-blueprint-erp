"""Run inside the current backend container; observations only, no mutation."""
import json
import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
import django
django.setup()
from django.conf import settings
from django.db import connection, transaction
from apps.platformops.models import BackupRecord, RestoreDrillRecord

with transaction.atomic():
    with connection.cursor() as cursor:
        cursor.execute("SET TRANSACTION READ ONLY")
        cursor.execute("SET LOCAL statement_timeout = '4s'")
        cursor.execute("SET LOCAL lock_timeout = '500ms'")
    backup = BackupRecord.objects.filter(status="SUCCEEDED").order_by("-created_at").first()
    restore = RestoreDrillRecord.objects.filter(status="SUCCEEDED").order_by("-created_at").first()
    evidence = {
        "database_mode": "read only",
        "image_build_sha": os.getenv("APP_BUILD_SHA", "unknown"),
        "gate_key_configured": bool(os.getenv("GATE_ID_ENCRYPTION_KEY", "")),
        "global_time_zone": settings.TIME_ZONE,
        "gate_time_zone": os.getenv("GATE_TIME_ZONE", "Asia/Kolkata"),
        "latest_successful_backup": {"id": str(backup.id), "created_at": backup.created_at.isoformat(), "checksum_sha256": backup.checksum_sha256, "size_bytes": backup.size_bytes} if backup else None,
        "latest_successful_restore": {"id": str(restore.id), "created_at": restore.created_at.isoformat(), "smoke_test_passed": restore.smoke_test_passed} if restore else None,
    }
print(json.dumps(evidence, sort_keys=True))
